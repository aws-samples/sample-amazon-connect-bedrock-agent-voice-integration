#!/usr/bin/env node

// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from 'aws-cdk-lib';
import { BookingAssistantStack } from '../lib/booking_assistant-stack';
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';
import { Aspects } from 'aws-cdk-lib';

const app = new cdk.App();

// Add CDK-nag checks with suppressions for specific rules
Aspects.of(app).add(
  new AwsSolutionsChecks({
    verbose: true,
  })
);

const bookingAssistantStack = new BookingAssistantStack(app, 'BookingAssistantStack', {});

NagSuppressions.addResourceSuppressions(
  bookingAssistantStack,
  [
    {
      id: 'AwsSolutions-IAM4',
      reason: 'Allow AWSLambdaBasicExecutionRole',
      appliesTo: [`Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole`],
    },
  ],
  true
);
