// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from 'aws-cdk-lib';
import * as fs from 'fs';
import { Construct } from 'constructs';
import { aws_connect } from 'aws-cdk-lib';
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from 'aws-cdk-lib/custom-resources';
import { NagSuppressions } from 'cdk-nag';

interface ConnectCallStackProps extends cdk.NestedStackProps {
  botName: string;
  botAliasArn: string;
}

export class ConnectCallStack extends cdk.NestedStack {
  phoneNumber: string;

  constructor(scope: Construct, id: string, props: ConnectCallStackProps) {
    super(scope, id, props);
    const { botName, botAliasArn } = props;

    const connectInstance = new aws_connect.CfnInstance(this, 'ConnectInstance', {
      instanceAlias: cdk.Names.uniqueId(this),
      attributes: {
        inboundCalls: true,
        outboundCalls: false,
        contactflowLogs: true,
      },
      identityManagementType: 'CONNECT_MANAGED',
    });

    new aws_connect.CfnIntegrationAssociation(this, 'LexIntegrationAssociation', {
      instanceId: connectInstance.attrArn,
      integrationArn: botAliasArn,
      integrationType: 'LEX_BOT',
    });

    const contactFlowSchema = fs
      .readFileSync('lib/contact-flow.json', 'utf-8')
      .replace(/{{BotName}}/g, botName)
      .replace(/{{BotAliasArn}}/g, botAliasArn);

    const contactFlow = new aws_connect.CfnContactFlow(this, 'ContactFlow', {
      instanceArn: connectInstance.attrArn,
      name: 'AssistantFlow',
      type: 'CONTACT_FLOW',
      content: contactFlowSchema,
    });

    const phoneNumber = new aws_connect.CfnPhoneNumber(this, 'PhoneNumber', {
      targetArn: connectInstance.attrArn,
      countryCode: 'GB',
      type: 'TOLL_FREE',
    });

    new AwsCustomResource(this, 'AssociatePhoneNumberContactFlow', {
      onCreate: {
        service: 'Connect',
        action: 'associatePhoneNumberContactFlow',
        parameters: {
          InstanceId: connectInstance.attrArn,
          PhoneNumberId: phoneNumber.attrPhoneNumberArn,
          ContactFlowId: contactFlow.attrContactFlowArn,
        },
        physicalResourceId: PhysicalResourceId.of('PhoneNumberContactFlowAssociation'),
      },
      policy: AwsCustomResourcePolicy.fromSdkCalls({
        resources: [connectInstance.attrArn, phoneNumber.attrPhoneNumberArn, contactFlow.attrContactFlowArn],
      }),
    });

    this.phoneNumber = phoneNumber.attrAddress;

    NagSuppressions.addResourceSuppressions(
      this,
      [
        {
          id: 'AwsSolutions-L1',
          reason: 'Allow AWSCustomResource to use latest runtime',
        },
      ],
      true
    );
  }
}
