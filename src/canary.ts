import { Resource } from 'cdktf';
import {
  CloudwatchMetricAlarm,
  DataAwsIamPolicyDocument,
  IamPolicy,
  IamRole,
  IamRolePolicyAttachment,
  S3Bucket,
  SyntheticsCanary,
} from '@cdktf/provider-aws';
import { DataArchiveFile } from '@cdktf/provider-archive';
import { config } from './config';
import { PocketPagerDuty } from '@pocket-tools/terraform-modules';

type CanaryProps = {
  region: string;
  accountId: string;
  canaryBucket: S3Bucket;
  pagerDutyHandler: PocketPagerDuty;
  name: string,
  source: string,
};

export class Canary extends Resource {
  constructor(scope, name, private readonly props: CanaryProps) {
    super(scope, name);

    let canary = this.createSyntheticCanary();
    this.createSyntheticAlarm(canary.name, props.pagerDutyHandler);
  }

  private getPolicyDocument() {
    const document = {
      version: '2012-10-17',
      statement: [
        {
          effect: 'Allow',
          actions: [
            'logs:CreateLogGroup',
            'logs:CreateLogStream',
            'logs:PutLogEvents',
          ],
          resources: ['arn:aws:logs:*:*:*'],
        },
        {
          effect: 'Allow',
          actions: [
            's3:ListAllMyBuckets',
            'cloudwatch:PutMetricData',
            'xray:PutTraceSegments',
          ],
          resources: ['*'],
        },
        {
          effect: 'Allow',
          actions: ['s3:PutObject', 's3:GetBucketLocation'],
          resources: [
            `arn:aws:s3:::${this.props.canaryBucket.id}`,
            `arn:aws:s3:::${this.props.canaryBucket.id}/*`,
          ],
        },
        {
          effect: 'Allow',
          actions: ['ssm:GetParameter'],
          resources: [
            `arn:aws:ssm:${this.props.region}:${this.props.accountId}:parameter/${config.name}/${config.environment}/Canary/savedItems/*`,
          ],
        },
      ],
    };

    return new DataAwsIamPolicyDocument(
      this,
      'execution-policy-document',
      document
    ).json;
  }

  private syntheticsAssumePolicyDocument() {
    return new DataAwsIamPolicyDocument(this, `${this.props.name}-assume-policy-document`, {
      version: '2012-10-17',
      statement: [
        {
          effect: 'Allow',
          actions: ['sts:AssumeRole'],
          principals: [
            {
              identifiers: ['lambda.amazonaws.com', 'synthetics.amazonaws.com'],
              type: 'Service',
            },
          ],
        },
      ],
    }).json;
  }

  private createSyntheticAlarm(canaryName: string, pagerDuty: PocketPagerDuty) {
    return new CloudwatchMetricAlarm(this, `synthetics-failed-alarm`, {
      alarmName: `${canaryName}-SyntheticsFailed-Alarm`,
      namespace: 'CloudWatchSynthetics',
      metricName: '5xx',
      dimensions: {
        CanaryName: canaryName,
      },
      period: 960, //in seconds
      evaluationPeriods: 3,
      statistic: 'SampleCount',
      comparisonOperator: 'GreaterThanOrEqualToThreshold',
      threshold: 1,
      alarmDescription: `failed canary test: ${canaryName}`,
      insufficientDataActions: [],
      alarmActions: config.isDev ? [] : [pagerDuty.snsCriticalAlarmTopic.arn],
      tags: config.tags,
      treatMissingData: 'notBreaching',
    });
  }

  private syntheticsExecutionRole() {
    const iamRole = new IamRole(this, `${this.props.name}-synthetics-execution-role`, {
      name: `${config.prefix}-${this.props.name}-ExecutionRole`,
      assumeRolePolicy: this.syntheticsAssumePolicyDocument(),
    });

    const policy = new IamPolicy(this, `${this.props.name}-execution-policy`, {
      name: `${config.prefix}-${this.props.name}-ExecutionPolicy`,
      policy: this.getPolicyDocument(),
    });

    new IamRolePolicyAttachment(this, `${this.props.name}-execution-role-policy-attachment`, {
      role: iamRole.name,
      policyArn: policy.arn,
      dependsOn: [iamRole, policy],
    });

    return iamRole;
  }

  private createSyntheticCanary() {
    const zipFile = new DataArchiveFile(this, `${this.props.name}-synthetic-zip-file`, {
      type: 'zip',
      // We need the name to be unique for AWS to refresh its cache of the code,
      // and this is a way to randomize the name without importing an extra dependency.
      outputPath: `index-${(+new Date()).toString(36)}.zip`,
      sourceDir: this.props.source,
    });

    return new SyntheticsCanary(this, `${this.props.name}-synthetic`, {
      // Synthetics demands that names be 21 characters or less.
      // We are very sorry.
      name: this.props.name.toLowerCase(),
      artifactS3Location: `s3://${this.props.canaryBucket.id}`,
      executionRoleArn: this.syntheticsExecutionRole().arn,
      handler: 'index.handler',
      zipFile: zipFile.outputPath,
      runtimeVersion: 'syn-nodejs-puppeteer-3.2',
      schedule: [{ expression: 'rate(15 minutes)' }],
      runConfig: [
        {
          activeTracing: true,
        },
      ],
    });
  }
}
