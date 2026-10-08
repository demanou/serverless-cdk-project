import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { ServerlessCdkProjectStack } from '../lib/serverless-cdk-project-stack';

let template: Template;

beforeAll(() => {
  const app = new cdk.App();
  const stack = new ServerlessCdkProjectStack(app, 'TestStack', {
    tableName: 'StudentItems',
    env: { account: '123456789012', region: 'ca-central-1' },
  });
  template = Template.fromStack(stack);
});

describe('DynamoDB', () => {
  test('creates the StudentItems table with on-demand billing', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'StudentItems',
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    });
  });

  test('table is deleted when the stack is destroyed', () => {
    template.hasResource('AWS::DynamoDB::Table', { DeletionPolicy: 'Delete' });
  });
});

describe('Lambda', () => {
  test('uses a supported Node.js runtime and gets the table name', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'StudentItemsHandler',
      Runtime: 'nodejs24.x',
      Environment: { Variables: { TABLE_NAME: 'StudentItems' } },
    });
  });

  test('IAM policy gives DynamoDB access to this table only (no wildcard)', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyName: 'LambdaDynamoAccess',
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['dynamodb:GetItem', 'dynamodb:Scan']),
            Resource: { 'Fn::GetAtt': [Match.stringLikeRegexp('StudentItemsTable'), 'Arn'] },
          }),
        ]),
      },
    });
  });

  test('only this API can invoke the function', () => {
    template.hasResourceProperties('AWS::Lambda::Permission', {
      Principal: 'apigateway.amazonaws.com',
      SourceArn: Match.anyValue(),
    });
  });
});

describe('API Gateway', () => {
  test('exposes the five CRUD routes', () => {
    template.resourceCountIs('AWS::ApiGateway::Method', 5);
    for (const verb of ['GET', 'POST', 'PUT', 'DELETE']) {
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: verb,
        Integration: { Type: 'AWS_PROXY' },
      });
    }
  });

  test('is deployed to a "prod" stage so it has a callable URL', () => {
    template.resourceCountIs('AWS::ApiGateway::Deployment', 1);
    template.hasResourceProperties('AWS::ApiGateway::Stage', { StageName: 'prod' });
  });

  test('outputs the API URL', () => {
    template.hasOutput('ApiUrl', {});
  });
});

describe('Seed data', () => {
  test('inserts the two sample items', () => {
    template.resourceCountIs('Custom::AWS', 2);
  });
});
