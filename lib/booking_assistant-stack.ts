// copyright amazon.com, inc. or its affiliates. all rights reserved.
// spdx-license-identifier: mit-0

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { BookingAgentStack } from './booking-agent-stack';
import { LexChatStack } from './lex-chat-stack';
import { ConnectCallStack } from './connect-call-stack';

export class BookingAssistantStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const bookingAssistants = new BookingAgentStack(this, 'BookingAgentStack');

    const lexChat = new LexChatStack(this, 'LexChatStack', {
      bedrockAgent: bookingAssistants.bedrockAgent,
      bedrockAgentAliasId: bookingAssistants.bedrockAgentAliasId,
    });

    const { phoneNumber } = new ConnectCallStack(this, 'ConnectCallStack', { botName: lexChat.botName, botAliasArn: lexChat.botAliasArn });

    new cdk.CfnOutput(this, 'PhoneNumber', { description: 'Phone Number', value: phoneNumber });
  }
}
