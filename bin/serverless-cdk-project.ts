#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { ServerlessCdkProjectStack } from '../lib/serverless-cdk-project-stack';

const app = new cdk.App();
new ServerlessCdkProjectStack(app, 'ServerlessCdkProjectStack', {
  tableName: 'StudentItems',

    env: {
      account: '962500058125',
      region: 'ca-central-1',
    },

});
