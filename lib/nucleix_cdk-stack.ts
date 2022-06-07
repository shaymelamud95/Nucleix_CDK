import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as fsx from 'aws-cdk-lib/aws-fsx';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as directoryservice from 'aws-cdk-lib/aws-directoryservice';
import * as datasync from 'aws-cdk-lib/aws-datasync';
import { readFileSync } from 'fs';

export class NucleixCdkStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Define variables:
    const adDomain = "nucleix.com"
    const adAdminUsername = "admin"

    // Microsoft Active Directory Password
    const adPassword = new secretsmanager.Secret(this, 'AWSADAdminPassword', {
      secretName: "AWSADAdminPassword",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ domain: adDomain, username: adAdminUsername }),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 32
      },
    });

    // Create S3 Bucket where BAM files will be stored
    const bamBucket = new s3.Bucket(this, 'BamBucket', {
      versioned: true,
      bucketName: `bambucketnucleix-2204`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // 👇 create VPC in which we'll launch the Instance
    const vpc = new ec2.Vpc(this, 'cdk-vpc', {
      cidr: '10.0.0.0/16',
      natGateways: 0,
      maxAzs: 2,
      subnetConfiguration: [
        { name: 'public', cidrMask: 24, subnetType: ec2.SubnetType.PUBLIC },
      ],
    });

    // Microsoft Active Directory
    const cfnMicrosoftAD = new directoryservice.CfnMicrosoftAD(this, 'MicrosoftAD', {
      name: 'nucleix.com',
      password: adPassword.secretValueFromJson("password").unsafeUnwrap(),
      vpcSettings: {
        subnetIds: vpc.selectSubnets({ subnetType: ec2.SubnetType.PUBLIC }).subnetIds,
        vpcId: vpc.vpcId,
      }
    });
    
    // DHCP Options
    const cfnDHCPOptions = new ec2.CfnDHCPOptions(this, 'DHCPOptions', /* all optional props */ {
      domainName: adDomain,
      domainNameServers: cfnMicrosoftAD.attrDnsIpAddresses,
    });

    // DHCP Options Association
    const cfnDHCPOptionsAssociation = new ec2.CfnVPCDHCPOptionsAssociation(this, "DHCPOptionsAssociation", {
      dhcpOptionsId: cfnDHCPOptions.attrDhcpOptionsId,
      vpcId: vpc.vpcId
    })

    // Clients Security Group
    const clientSG = new ec2.SecurityGroup(this, "ClientSG", {
      vpc: vpc,
      allowAllOutbound: true
    })
    clientSG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(3389));
    clientSG.addIngressRule(clientSG, ec2.Port.allTraffic());

    // FSx Security Group
    const filesystemSG = new ec2.SecurityGroup(this, "FilesystemSG", {
      vpc: vpc,
      allowAllOutbound: true
    })
    filesystemSG.addIngressRule(clientSG, ec2.Port.tcp(445));
    filesystemSG.addIngressRule(clientSG, ec2.Port.tcp(5985));
    filesystemSG.addIngressRule(filesystemSG, ec2.Port.allTraffic());

    // FSx Filesystem
    const filesystemBam = new fsx.CfnFileSystem(this, 'FSxWindowsFilesystem', {
      fileSystemType: 'WINDOWS',
      subnetIds: vpc.selectSubnets({ subnetType: ec2.SubnetType.PUBLIC }).subnetIds,
      windowsConfiguration: {
        activeDirectoryId: cfnMicrosoftAD.ref,
        throughputCapacity: 32,
        preferredSubnetId: vpc.selectSubnets({ subnetType: ec2.SubnetType.PUBLIC }).subnetIds[0],
        deploymentType: "MULTI_AZ_1"
      },
      storageCapacity: 2000,
      storageType: 'HDD',
      securityGroupIds: [filesystemSG.securityGroupId],
      tags: [{
        key: 'Name',
        value: 'NucleixFSx',
      }],
    })

    // Create instance role
    const instanceRole = new iam.Role(this, "WindowsInstanceRole", {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      roleName: "windows-instance-role"
    })
    
    // Allow role to read the secret
    adPassword.grantRead(instanceRole)
    
    // 👇 create the EC2 Instance
    const ec2Instance1 = new ec2.Instance(this, 'ec2-instance', {
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      securityGroup: clientSG,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T2,
        ec2.InstanceSize.MEDIUM,
      ),
      role: instanceRole,
      machineImage: new ec2.WindowsImage(ec2.WindowsVersion.WINDOWS_SERVER_2019_ENGLISH_FULL_BASE),
      keyName: 'testing',
    });

    // 👇 load user data script
    const userDataScript = readFileSync('lib/user_data.ps1', 'utf8');

    // 👇 add user data to the EC2 instance
    ec2Instance1.addUserData(userDataScript);

    // Create Datasync Role
    const datasyncS3Role = new iam.Role(this, "S3DatasyncRole", {
      assumedBy: new iam.ServicePrincipal('datasync.amazonaws.com'),
      roleName: "datasync-s3"
    });

    // Grant permissions for the datasync role to Read/Write/Put from the S3 Bucket
    bamBucket.grantReadWrite(datasyncS3Role);
    bamBucket.grantPut(datasyncS3Role);

    // S3 Source Location
    const s3SourceLocation = new datasync.CfnLocationS3(this, 'S3SourceLocation', {
      s3BucketArn: bamBucket.bucketArn,
      s3Config: {
        bucketAccessRoleArn: datasyncS3Role.roleArn
      },
      subdirectory: 'source',
      tags: [{
        key: 'Name',
        value: 's3-source-location',
      }],
    });

    // S3 Destination Location
    const s3DestinationLocation = new datasync.CfnLocationS3(this, 'S3DestinationLocation', {
      s3BucketArn: bamBucket.bucketArn,
      s3Config: {
        bucketAccessRoleArn: datasyncS3Role.roleArn
      },
      subdirectory: 'destination',
      tags: [{
        key: 'Name',
        value: 's3-destination-location',
      }],
    });

    // Get current Region and Account ID to construct FSx ARN as it does not have a property that returns it
    const region = cdk.Stack.of(this).region
    const accountId = cdk.Stack.of(this).account

    // FSx location 
    const fsxLocation = new datasync.CfnLocationFSxWindows(this, 'FSxLocation', {
      fsxFilesystemArn: `arn:aws:fsx:${region}:${accountId}:file-system/${filesystemBam.ref}`,
      securityGroupArns: [clientSG.securityGroupId],
      user: `${adAdminUsername}@${adDomain}`,
      password: adPassword.secretValueFromJson("password").unsafeUnwrap(),
      domain: adDomain,
      subdirectory: 'share',
      tags: [{
        key: 'Name',
        value: 'fsx-share-location',
      }],
    });

    const datasyncLogGroup = new logs.LogGroup(this, "DatasyncLogGroup", {
      retention: 7,
      logGroupName: "datasync/logs"
    })

    // Datasync Tasks

    // S3 to FSx
    const s3ToFSx = new datasync.CfnTask(this, 'S3ToFSx', {
      destinationLocationArn: fsxLocation.attrLocationArn,
      sourceLocationArn: s3SourceLocation.s3BucketArn,
      cloudWatchLogGroupArn: datasyncLogGroup.logGroupArn,
      name: 's3-to-fsx',
      options: {
        transferMode: 'ALL',
        verifyMode: 'ONLY_FILES_TRANSFERRED',
      },
      tags: [{
        key: 'Name',
        value: 's3-to-fsx',
      }],
    });

    // FSx to S3
    const fsxToS3 = new datasync.CfnTask(this, 'FSxToS3', {
      destinationLocationArn: s3SourceLocation.s3BucketArn,
      sourceLocationArn: fsxLocation.attrLocationArn,
      cloudWatchLogGroupArn: datasyncLogGroup.logGroupArn,
      name: 'fsx-to-s3',
      options: {
        transferMode: 'ALL',
        verifyMode: 'ONLY_FILES_TRANSFERRED',
      },
      tags: [{
        key: 'Name',
        value: 'fsx-to-s3',
      }],
    });

    // Defining the order of the CDK Deployment
    cfnMicrosoftAD.node.addDependency(adPassword, vpc);
    cfnDHCPOptions.node.addDependency(cfnMicrosoftAD);
    filesystemBam.node.addDependency(cfnMicrosoftAD);
    ec2Instance1.node.addDependency(cfnMicrosoftAD, filesystemBam);
    s3SourceLocation.node.addDependency(bamBucket);
    s3DestinationLocation.node.addDependency(bamBucket);
    fsxLocation.node.addDependency(filesystemBam)
  }
}
