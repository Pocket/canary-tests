import { Construct } from 'constructs';
import {
  App,
  DataTerraformRemoteState,
  RemoteBackend,
  TerraformStack,
} from 'cdktf';
import {
  AwsProvider,
  DataAwsCallerIdentity,
  DataAwsRegion,
  S3Bucket,
} from '@cdktf/provider-aws';
import { config } from './config';
import { PocketPagerDuty } from '@pocket-tools/terraform-modules';
import { PagerdutyProvider } from '@cdktf/provider-pagerduty';
import { LocalProvider } from '@cdktf/provider-local';
import { NullProvider } from '@cdktf/provider-null';
import { ArchiveProvider } from '@cdktf/provider-archive';
import { Canary } from './canary';

class CanariesStack extends TerraformStack {
  private region: DataAwsRegion;
  private caller: DataAwsCallerIdentity;

  constructor(scope: Construct, name: string) {
    super(scope, name);

    new AwsProvider(this, 'aws', { region: 'us-east-1' });
    new PagerdutyProvider(this, 'pagerduty_provider', { token: undefined });
    new LocalProvider(this, 'local_provider');
    new NullProvider(this, 'null_provider');
    new ArchiveProvider(this, 'archive_provider');

    new RemoteBackend(this, {
      hostname: 'app.terraform.io',
      organization: 'Pocket',
      workspaces: [{ prefix: `${config.name}-` }],
    });

    this.region = new DataAwsRegion(this, 'region');
    this.caller = new DataAwsCallerIdentity(this, 'caller');
    const pagerDuty = this.createPagerDuty();

    const canaryBucket = this.createSyntheticsS3Bucket();

    //to create a new canary, set props, create a new `Canary` resource
    //and attach it to index.ts
    const canaryProps = {
      region: this.region.name,
      accountId: this.caller.accountId,
      canaryBucket: canaryBucket,
      pagerDutyHandler: pagerDuty,
      source: config.canary.source,
      name: `${config.shortName}-${config.environment}-e2esi`,

      //'e2esi' stands for "e2e-savedItems."
      // Synthetics demands that names be 21 characters or less.
    };
    new Canary(this, `${canaryProps.name}-e2e-canary`, canaryProps);
  }

  private createSyntheticsS3Bucket() {
    return new S3Bucket(this, 'synthetic-s3-bucket', {
      bucket:
        `Pocket-${config.prefix}-CanaryE2ETests-TestResults`.toLowerCase(),
      tags: config.tags,
    });
  }

  /**
   * Create PagerDuty service for alerts
   * @private
   */
  private createPagerDuty() {
    // don't create any pagerduty resources if in dev
    if (config.isDev) {
      return undefined;
    }

    const incidentManagement = new DataTerraformRemoteState(
      this,
      'incident_management',
      {
        organization: 'Pocket',
        workspaces: {
          name: 'incident-management',
        },
      }
    );

    return new PocketPagerDuty(this, 'pagerduty', {
      prefix: config.prefix,
      service: {
        criticalEscalationPolicyId: incidentManagement.get(
          'policy_backend_critical_id'
        ),
        nonCriticalEscalationPolicyId: incidentManagement.get(
          'policy_backend_non_critical_id'
        ),
      },
    });
  }
}

const app = new App();
new CanariesStack(app, config.domainPrefix);
app.synth();
