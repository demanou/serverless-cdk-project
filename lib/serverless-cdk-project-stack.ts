import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';

import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from 'aws-cdk-lib/custom-resources';

import * as s3_assets from 'aws-cdk-lib/aws-s3-assets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';

import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as path from 'path';

export interface ServerlessCdkProjectStackProps extends cdk.StackProps {
  /** Name of the DynamoDB table. */
  tableName: string;
  /** API Gateway stage name (default: "prod"). */
  stageName?: string;
}

export class ServerlessCdkProjectStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ServerlessCdkProjectStackProps) {
    super(scope, id, props);

    const tableName = props.tableName;
    const stageName = props.stageName ?? 'prod';

    // Step 1: Create a DynamoDB table CfnTable construct
    const cfnTable = new dynamodb.CfnTable(this, 'StudentItemsTable', {
      tableName: tableName,
      // Define the schema attributes and their types
      attributeDefinitions: [
        { attributeName: 'id', attributeType: 'S' }
      ],
      // Define the primary keys (HASH = Partition Key)
      keySchema: [
        { attributeName: 'id', keyType: 'HASH' }
      ],
      // Configure Billing Mode (PAY_PER_REQUEST for On-Demand)
      billingMode: 'PAY_PER_REQUEST'
    });

    // Enable RemovalPolicy = DESTROY
    cfnTable.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);


    // Step 2: Populate the StudentItems table
    // The seed resources reference the table itself (not just its name), so
    // CloudFormation waits for the table to exist before inserting items.
    // Insert sample item 1001
    createDynamoInsertResource(this, "InsertItem1001", cfnTable, {
      id: "1001",
      name: "AWS CDK",
      description: "Infrastructure as Code",
      category: "Cloud"
    });

    // Insert sample item 1002
    createDynamoInsertResource(this, "InsertItem1002", cfnTable, {
      id: "1002",
      name: "AWS Lambda",
      description: "Serverless Compute",
      category: "Serverless"
    });


    // Step 3: IAM roles and policies
    // 3.1. IAM Role for Lambda
    const lambdaRole = new iam.CfnRole(this, 'LambdaDynamoRole', {
      assumeRolePolicyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { Service: 'lambda.amazonaws.com' },
            Action: 'sts:AssumeRole'
          }
        ]
      }
    });

    // 3.2. IAM Policy for Lambda to access DynamoDB and Logs
    // Least privilege: DynamoDB actions on this table only, logs on this function's log group only.
    const functionName = 'StudentItemsHandler';
    const lambdaPolicy = new iam.CfnPolicy(this, 'LambdaDynamoPolicy', {
      policyName: 'LambdaDynamoAccess',
      roles: [lambdaRole.ref],
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: [
              'dynamodb:GetItem',
              'dynamodb:PutItem',
              'dynamodb:UpdateItem',
              'dynamodb:DeleteItem',
              'dynamodb:Scan'
            ],
            Resource: cfnTable.attrArn
          },
          {
            Effect: 'Allow',
            Action: [
              'logs:CreateLogGroup',
              'logs:CreateLogStream',
              'logs:PutLogEvents'
            ],
            Resource: `arn:${cdk.Aws.PARTITION}:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:log-group:/aws/lambda/${functionName}:*`
          }
        ]
      }
    });
  
    // Step 4: Deployment of Lambda Function
    // 4.1. Package the local Lambda folder as a CDK Asset (zips and uploads to S3 automatically)
    const lambdaAsset = new s3_assets.Asset(this, 'LambdaAsset', {
      path: path.join(__dirname, '../lambda'),
    });

    // 4.2. Create Lambda function 
    const lambdaFn = new lambda.CfnFunction(this, 'StudentLambda', {
      functionName: functionName,
      handler: 'index.handler',
      // nodejs20.x is deprecated; nodejs24.x is the current LTS runtime
      runtime: 'nodejs24.x',
      role: lambdaRole.attrArn,
      architectures: ['x86_64'],
      memorySize: 256,
      timeout: 10,
      environment: {
        variables: {
          TABLE_NAME: tableName
        }
      },
      code: {
        s3Bucket: lambdaAsset.s3BucketName,
        s3Key: lambdaAsset.s3ObjectKey,
      },
    });
    // Make sure the role has its permissions before the function is created
    lambdaFn.addResourceDependency(lambdaPolicy);


    // Step 5: Implementation of API Gateway, resources, and methods
    // 5.1. Create a REST API
    const api = new apigateway.CfnRestApi(this, "StudentApi", {
      name: "StudentItemsApi",
      description: "CRUD API for the StudentItems DynamoDB table",
      endpointConfiguration: { types: ["REGIONAL"] },
    });

    // 5.1.1. Grant API Gateway permission to invoke the Lambda
    // (scoped to this API only, instead of any API Gateway in the account)
    new lambda.CfnPermission(this, "ApiGatewayInvokePermission", {
      action: "lambda:InvokeFunction",
      principal: "apigateway.amazonaws.com",
      functionName: lambdaFn.ref,
      sourceArn: `arn:${cdk.Aws.PARTITION}:execute-api:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:${api.ref}/*/*/*`,
    });

    // 5.2. Get Root resource ID
    const rootId = api.attrRootResourceId;

    // 5.3. Create resources
    // 5.3.1. Get /items Resource
    const itemsResource = createApiResource(
      this,
      "ItemsResource",
      api.ref,
      rootId,
      "items"
    );

    // 5.3.2. /items/{id} Resource
    const itemIdResource = createApiResource(
      this,
      "ItemIdResource",
      api.ref,
      itemsResource.ref,
      "{id}"
    );
  
    // 5.4. Create routes
    // 5.4.1. GET /items
    const getItemsMethod = createApiGatewayMethod(
      this,
      "GetItemsMethod",
      api.ref,
      itemsResource.ref,
      "GET",
      lambdaFn.attrArn,
      this.region
    );

    // 5.4.2. POST /items
    const postItemsMethod = createApiGatewayMethod(
      this,
      "PostItemsMethod",
      api.ref,
      itemsResource.ref,
      "POST",
      lambdaFn.attrArn,
      this.region
    );

    // 5.4.3. GET /items/{id}
    const getItemByIdMethod = createApiGatewayMethod(
      this,
      "GetItemByIdMethod",
      api.ref,
      itemIdResource.ref,
      "GET",
      lambdaFn.attrArn,
      this.region
    );

    // 5.4.4. PUT /items/{id}
    const putItemByIdMethod = createApiGatewayMethod(
      this,
      "PutItemByIdMethod",
      api.ref,
      itemIdResource.ref,
      "PUT",
      lambdaFn.attrArn,
      this.region
    );

    // 5.4.5. DELETE /items/{id}
    const deleteItemByIdMethod = createApiGatewayMethod(
      this,
      "DeleteItemByIdMethod",
      api.ref,
      itemIdResource.ref,
      "DELETE",
      lambdaFn.attrArn,
      this.region
    );

    // Step 6: Deploy the API to a stage
    // Without a deployment and a stage, the API exists but has no URL that
    // can be called. The deployment must wait until every method exists.
    const deployment = new apigateway.CfnDeployment(this, "StudentApiDeployment", {
      restApiId: api.ref,
      description: "Initial deployment",
    });
    for (const method of [getItemsMethod, postItemsMethod, getItemByIdMethod, putItemByIdMethod, deleteItemByIdMethod]) {
      deployment.addResourceDependency(method);
    }

    const stage = new apigateway.CfnStage(this, "StudentApiStage", {
      restApiId: api.ref,
      deploymentId: deployment.ref,
      stageName: stageName,
    });

    // Step 7: Outputs
    new cdk.CfnOutput(this, "ApiUrl", {
      description: "Base URL of the Student Items API",
      value: `https://${api.ref}.execute-api.${cdk.Aws.REGION}.${cdk.Aws.URL_SUFFIX}/${stage.ref}/`,
    });
    new cdk.CfnOutput(this, "TableName", { value: cfnTable.ref });
    new cdk.CfnOutput(this, "LambdaFunctionName", { value: lambdaFn.ref });
  }
}

/**
 * Creates a CFN-compatible AwsCustomResource that inserts an item into DynamoDB.
 */
export function createDynamoInsertResource(
  scope: Construct,
  id: string,
  table: dynamodb.CfnTable,
  item: Record<string, string>
) {
  // Convert JS object into DynamoDB AttributeValue map
  const dynamoItem: Record<string, any> = {};
  for (const [key, value] of Object.entries(item)) {
    dynamoItem[key] = { S: value };
  }

  return new AwsCustomResource(scope, id, {
    onCreate: {
      service: "DynamoDB",
      action: "putItem",
      parameters: {
        TableName: table.ref,
        Item: dynamoItem,
      },
      physicalResourceId: PhysicalResourceId.of(id),
    },
    policy: AwsCustomResourcePolicy.fromSdkCalls({
      resources: [table.attrArn],
    }),
  });
}

/**
 * Creates a CFN-level API Gateway Resource.
 */
export function createApiResource(
  scope: Construct,
  id: string,
  apiId: string,
  parentId: string,
  pathPart: string
) {
  return new apigateway.CfnResource(scope, id, {
    restApiId: apiId,
    parentId: parentId,
    pathPart: pathPart,
  });
}

/**
 * Creates a CFN-level API Gateway Method integrated with a Lambda function.
 */
export function createApiGatewayMethod(
  scope: Construct,
  id: string,
  apiId: string,
  resourceId: string,
  httpMethod: string,
  lambdaArn: string,
  region: string
) {
  return new apigateway.CfnMethod(scope, id, {
    restApiId: apiId,
    resourceId: resourceId,
    httpMethod: httpMethod,
    authorizationType: "NONE",
    integration: {
      type: "AWS_PROXY",
      integrationHttpMethod: "POST",
      uri: `arn:aws:apigateway:${region}:lambda:path/2015-03-31/functions/${lambdaArn}/invocations`,
    },
  });
}
