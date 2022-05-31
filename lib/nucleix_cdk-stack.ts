import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
// import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as cdk from 'aws-cdk-lib';
import { aws_s3 as s3 } from 'aws-cdk-lib';
import * as fsx from 'aws-cdk-lib/aws-fsx';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { aws_directoryservice as directoryservice } from 'aws-cdk-lib';
import { aws_ec2 } from 'aws-cdk-lib';
import {readFileSync} from 'fs';
import { aws_datasync as datasync } from 'aws-cdk-lib';

// declare const vpc: ec2.Vpc;

export class NucleixCdkStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    
    // Default secret
    const secret = new secretsmanager.Secret(this, 'Secret');
    // Using the default secret
    new iam.User(this, 'User', {
      password: secret.secretValue,
    });
    // Templated secret
    const templatedSecret = new secretsmanager.Secret(this, 'TemplatedSecret', {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'user' }),
        generateStringKey: 'password',
      },
    });
    // Using the templated secret
    new iam.User(this, 'OtherUser', {
      userName: templatedSecret.secretValueFromJson('username').toString(),
      password: templatedSecret.secretValueFromJson('password'),
    });

    
    // 👇 load user data script
    const userDataScript = readFileSync('./lib/user-data.sh', 'utf8');

    // active directory
    const cfnMicrosoftAD = new directoryservice.CfnMicrosoftAD(this, 'MyCfnMicrosoftAD', {
      name: 'name',
      password: 'password',
      vpcSettings: {
        subnetIds: ['subnetIds'],
        vpcId: 'vpcId',
      },
    
      // the properties below are optional
      createAlias: false,
      edition: 'edition',
      enableSso: false,
      shortName: 'shortName',
    });

    const bamBucket =new s3.Bucket(this, 'BamBucket', {
      versioned: true,
      bucketName: `bambucketnucleix`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // 👇 create VPC in which we'll launch the Instance
    const vpc = new ec2.Vpc(this, 'cdk-vpc', {
      cidr: '10.0.0.0/16',
      natGateways: 0,
      subnetConfiguration: [
        {name: 'public', cidrMask: 24, subnetType: ec2.SubnetType.PUBLIC},
      ],
    });

    // The code below shows an example of how to instantiate this type.
    // The values are placeholders you should change.
    const cfnDHCPOptions = new ec2.CfnDHCPOptions(this, 'MyCfnDHCPOptions', /* all optional props */ {
      domainName: 'domainName',
      domainNameServers: ['domainNameServers'],
      netbiosNameServers: ['netbiosNameServers'],
      netbiosNodeType: 123,
      ntpServers: ['ntpServers'],
      tags: [{
        key: 'key',
        value: 'value',
      }],
    });

    // 👇 create Security Group for the Instance
    const webserverSG = new ec2.SecurityGroup(this, 'webserver-sg', {
      vpc,
      allowAllOutbound: true,
    });

    // 👇 create a Role for the EC2 Instance
    const webserverRole = new iam.Role(this, 'webserver-role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3ReadOnlyAccess'),
      ],
    });

    // 👇 create the EC2 Instance
    const ec2Instance1 = new ec2.Instance(this, 'ec2-instance1', {
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      role: webserverRole,
      securityGroup: webserverSG,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE2,
        ec2.InstanceSize.MICRO,
      ),
      machineImage: new ec2.WindowsImage(ec2.WindowsVersion.WINDOWS_SERVER_2019_ENGLISH_FULL_BASE),
      keyName: 'ec2-key-pair',
    });

    const ec2Instance2 = new ec2.Instance(this, 'ec2-instance2', {
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      role: webserverRole,
      securityGroup: webserverSG,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE2,
        ec2.InstanceSize.MICRO,
      ),
      machineImage: new ec2.WindowsImage(ec2.WindowsVersion.WINDOWS_SERVER_2019_ENGLISH_FULL_BASE),
      keyName: 'ec2-key-pair',
    });

    // const ec2Instance3 = new ec2.Instance(this, 'ec2-instance3', {
    //   vpc,
    //   vpcSubnets: {
    //     subnetType: ec2.SubnetType.PUBLIC,
    //   },
    //   role: webserverRole,
    //   securityGroup: webserverSG,
    //   instanceType: ec2.InstanceType.of(
    //     ec2.InstanceClass.BURSTABLE2,
    //     ec2.InstanceSize.MICRO,
    //   ),
    //   machineImage: new ec2.WindowsImage(ec2.WindowsVersion.WINDOWS_SERVER_2019_ENGLISH_FULL_BASE),
    //   keyName: 'ec2-key-pair',
    // });

    // 👇 add user data to the EC2 instance
    ec2Instance1.addUserData(userDataScript);
    ec2Instance2.addUserData(userDataScript);
    // ec2Instance3.addUserData(userDataScript);

    const fileSystemBam = new fsx.CfnFileSystem(this, 'MyCfnFileSystem' ,{
        fileSystemType:'WINDOWS',
        subnetIds:['subnets'],
        windowsConfiguration: {
            activeDirectoryId:'directoryid',
            throughputCapacity: 32,
            preferredSubnetId:'subnets[0]',
            deploymentType:"MULTI_AZ_1"
          },
        storageCapacity:32,
        storageType:'HDD',
        securityGroupIds: ['securityGroupIds'],
        tags: [{
          key: 'Name',
          value: 'fsx1',
        }],
      })

    // const metrixBucket =new s3.Bucket(this, 'MetrixBucket', {
    //   versioned: true,
    //   bucketName: `metrixbucketnucleix`,
    //   removalPolicy: cdk.RemovalPolicy.DESTROY,
    //   autoDeleteObjects: true,
    // });

    // Location
    const cfnLocationS3 = new datasync.CfnLocationS3(this, 'MyCfnLocationS3', {
      s3BucketArn: 's3BucketArn',
      s3Config: {
        bucketAccessRoleArn: 'bucketAccessRoleArn',
      },
    
      // the properties below are optional
      s3StorageClass: 's3StorageClass',
      subdirectory: 'subdirectory',
      tags: [{
        key: 'key',
        value: 'value',
      }],
    });

    //LocationFSxWindows 
    const cfnLocationFSxWindows = new datasync.CfnLocationFSxWindows(this, 'MyCfnLocationFSxWindows', {
      fsxFilesystemArn: 'fsxFilesystemArn',
      password: 'password',
      securityGroupArns: ['securityGroupArns'],
      user: 'user',
    
      // the properties below are optional
      domain: 'domain',
      subdirectory: 'subdirectory',
      tags: [{
        key: 'key',
        value: 'value',
      }],
    });

    // datasync Task
    const cfnTask = new datasync.CfnTask(this, 'MyCfnTask', {
      destinationLocationArn: 'destinationLocationArn',
      sourceLocationArn: 'sourceLocationArn',
    
      // the properties below are optional
      cloudWatchLogGroupArn: 'cloudWatchLogGroupArn',
      excludes: [{
        filterType: 'filterType',
        value: 'value',
      }],
      includes: [{
        filterType: 'filterType',
        value: 'value',
      }],
      name: 'name',
      options: {
        atime: 'atime',
        bytesPerSecond: 123,
        gid: 'gid',
        logLevel: 'logLevel',
        mtime: 'mtime',
        overwriteMode: 'overwriteMode',
        posixPermissions: 'posixPermissions',
        preserveDeletedFiles: 'preserveDeletedFiles',
        preserveDevices: 'preserveDevices',
        securityDescriptorCopyFlags: 'securityDescriptorCopyFlags',
        taskQueueing: 'taskQueueing',
        transferMode: 'transferMode',
        uid: 'uid',
        verifyMode: 'verifyMode',
      },
      schedule: {
        scheduleExpression: 'scheduleExpression',
      },
      tags: [{
        key: 'key',
        value: 'value',
      }],
    });

    // Defining the order of the CDK Deployment
    secret.node.addDependency(vpc);
    cfnMicrosoftAD.node.addDependency(secret);
    fileSystemBam.node.addDependency(cfnMicrosoftAD);
    cfnDHCPOptions.node.addDependency(cfnMicrosoftAD);
    secret.node.addDependency(cfnDHCPOptions);
    // ec2Instance1.node.addDependency(set_dhcp_option_to_vpc);
    // ec2Instance1.node.addDependency(set_dhcp_option_to_vpc);
    // ec2Instance1.node.addDependency(set_dhcp_option_to_vpc);
  }
}
