// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { aws_lex, aws_iam } from 'aws-cdk-lib';

interface LexChatStackProps extends cdk.NestedStackProps {
  bedrockAgent: cdk.aws_bedrock.CfnAgent;
  bedrockAgentAliasId: string;
}

export class LexChatStack extends cdk.NestedStack {
  botName: string;
  botAliasArn: string;

  constructor(scope: Construct, id: string, props: LexChatStackProps) {
    super(scope, id, props);

    const { bedrockAgent, bedrockAgentAliasId } = props;

    const role = new aws_iam.Role(this, 'lexRole', {
      assumedBy: new aws_iam.ServicePrincipal('lexv2.amazonaws.com'),
    });

    role.addToPolicy(
      new aws_iam.PolicyStatement({
        effect: aws_iam.Effect.ALLOW,
        actions: ['bedrock:InvokeAgent'],
        resources: [`arn:aws:bedrock:${this.region}:${this.account}:agent-alias/${bedrockAgent.attrAgentId}/${bedrockAgentAliasId}`],
      })
    );

    const bot = new aws_lex.CfnBot(this, 'Bot', {
      name: cdk.Names.uniqueId(this),
      dataPrivacy: { ChildDirected: false },
      idleSessionTtlInSeconds: 60 * 60,
      roleArn: role.roleArn,
      botLocales: [
        {
          localeId: 'en_GB',
          nluConfidenceThreshold: 0.1,
          voiceSettings: {
            engine: 'generative',
            voiceId: 'Amy',
          },
          intents: [
            {
              name: 'BookingAgentIntent',
              parentIntentSignature: 'AMAZON.BedrockAgentIntent',
              description: 'Intent for handling travel-related inquiries and bookings',
              bedrockAgentIntentConfiguration: {
                bedrockAgentConfiguration: {
                  bedrockAgentId: bedrockAgent.attrAgentId,
                  bedrockAgentAliasId,
                },
              },
              sampleUtterances: [],
            },
            {
              name: 'FallbackIntent',
              parentIntentSignature: 'AMAZON.FallbackIntent',
              description: 'Default intent when no other intent matches',
            },
          ],
        },
      ],
      autoBuildBotLocales: true,
    });

    this.botName = bot.name;
    this.botAliasArn = `arn:aws:lex:${this.region}:${this.account}:bot-alias/${bot.attrId}/TSTALIASID`;
  }
}
