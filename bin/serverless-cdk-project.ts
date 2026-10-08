#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { ServerlessCdkProjectStack } from '../lib/serverless-cdk-project-stack';

const app = new cdk.App();

new ServerlessCdkProjectStack(app, 'ServerlessCdkProjectStack', {
  tableName: 'StudentItems',
  stageName: 'prod',

  // The account and Region come from your AWS CLI profile, so no account ID
  // is hard-coded in the repository. Region defaults to ca-central-1.
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'ca-central-1',
  },
});
