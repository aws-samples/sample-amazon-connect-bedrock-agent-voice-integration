// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as fs from 'fs';
import apiSchema from './api-schema.json';
import { NagSuppressions } from 'cdk-nag';

export class BookingAgentStack extends cdk.NestedStack {
  bedrockAgent: bedrock.CfnAgent;
  bedrockAgentAliasId: string;

  constructor(scope: Construct, id: string, props?: cdk.NestedStackProps) {
    super(scope, id, props);

    // DynamoDB Tables
    const customersTable = new dynamodb.Table(this, 'CustomerTable', {
      partitionKey: { name: 'customerId', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For development only
    });

    const tradesPersonsTable = new dynamodb.Table(this, 'TradesPersonsTable', {
      partitionKey: { name: 'tradesPersonId', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For development only
    });

    // Add GSI for searching plumbers by specialty
    tradesPersonsTable.addGlobalSecondaryIndex({
      indexName: 'TradeIndex',
      partitionKey: { name: 'trade', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'city', type: dynamodb.AttributeType.STRING },
    });

    const bookingsTable = new dynamodb.Table(this, 'BookingsTable', {
      partitionKey: { name: 'bookingId', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For development only
    });

    // Add GSI for searching bookings by customerId
    bookingsTable.addGlobalSecondaryIndex({
      indexName: 'CustomerIdIndex',
      partitionKey: { name: 'customerId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'slot', type: dynamodb.AttributeType.STRING },
    });

    // Add GSI for searching bookings by plumberId
    bookingsTable.addGlobalSecondaryIndex({
      indexName: 'TradesPersonIdIndex',
      partitionKey: { name: 'tradesPersonId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'slot', type: dynamodb.AttributeType.STRING },
    });

    // Create a Python Lambda function for all booking assistant actions
    const assistantLambda = new lambda.Function(this, 'AssistantLambda', {
      tracing: lambda.Tracing.ACTIVE,
      runtime: lambda.Runtime.PYTHON_3_13,
      code: lambda.Code.fromAsset('./lambda/python'),
      handler: 'index.handler',
      environment: {
        CUSTOMERS_TABLE: customersTable.tableName,
        TRADESPERSON_TABLE: tradesPersonsTable.tableName,
        BOOKINGS_TABLE: bookingsTable.tableName,
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      snapStart: lambda.SnapStartConf.ON_PUBLISHED_VERSIONS,
    });

    const version = assistantLambda.currentVersion;

    // Create an alias pointing to this version
    const lambdaAlias = new lambda.Alias(this, 'AssistantLambdaAlias', {
      aliasName: 'prod',
      version: version,
    });

    // Grant the Lambda function read/write permissions to the DynamoDB tables
    customersTable.grantReadWriteData(lambdaAlias);
    tradesPersonsTable.grantReadWriteData(lambdaAlias);
    bookingsTable.grantReadWriteData(lambdaAlias);

    // Create IAM role for Bedrock agent
    const bedrockAgentRole = new iam.Role(this, 'BedrockAgentRole', {
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonBedrockFullAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchLogsFullAccess'),
      ],
    });

    const modelId = 'amazon.nova-micro-v1:0';

    // Allow Bedrock agent to invoke the Lambda function
    lambdaAlias.grantInvoke(bedrockAgentRole);

    const agentInstructions = fs.readFileSync('lib/agent-instruction.txt', 'utf8');

    const englishAgent = new bedrock.CfnAgent(this, 'Agent', {
      agentName: 'BookingAssistant',
      autoPrepare: true,
      foundationModel: modelId,
      idleSessionTtlInSeconds: 1800,
      instruction: agentInstructions,
      description: 'A virtual assistant that helps customers book tradespersons',
      agentResourceRoleArn: bedrockAgentRole.roleArn,
      actionGroups: [
        {
          actionGroupName: 'BookingActions',
          actionGroupExecutor: {
            lambda: lambdaAlias.functionArn,
          },
          apiSchema: {
            payload: JSON.stringify(apiSchema),
          },
          description: 'Action group for booking operations',
        },
      ],
    });

    new lambda.CfnPermission(this, 'EnglishBedrockAgentLambdaPermission', {
      action: 'lambda:InvokeFunction',
      functionName: lambdaAlias.functionName,
      principal: 'bedrock.amazonaws.com',
      sourceArn: englishAgent.attrAgentArn,
    });

    this.bedrockAgent = englishAgent;
    this.bedrockAgentAliasId = 'TSTALIASID';

    // Suppress CDK-NAG rule for wildcard in log group resource
    NagSuppressions.addResourceSuppressions(
      assistantLambda,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'lambda needs access to all dynamodb tables',
        },
      ],
      true
    );

    NagSuppressions.addResourceSuppressions(
      bedrockAgentRole,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason: 'CfnAgent needs these permission to create the Agent',
          appliesTo: [
            `Policy::arn:<AWS::Partition>:iam::aws:policy/AmazonBedrockFullAccess`,
            `Policy::arn:<AWS::Partition>:iam::aws:policy/CloudWatchLogsFullAccess`,
          ],
        },
      ],
      true
    );
  }
}
