import time
import boto3
import os

print('Loading function')
DATASYNC_TASK_ARN = os.environ["DATASYNC_TASK_ARN"]
BAM_FILES_BUCKET = os.environ["BAM_FILES_BUCKET"]

# Initialize clients
datasync = boto3.client('datasync')
s3 = boto3.client("s3")


def lambda_handler(event, context):
    # Validate event
    objectKey = ""
    try:
        objectKey = event["Records"][0]["s3"]["object"]["key"]
        print(f"Object key: {objectKey}")
    except KeyError:
        raise KeyError(
            "Received invalid event - unable to locate Object key to upload.", event
        )

    # get the file from S3 to a local file.
    links_bucket = event["Records"][0]["s3"]["bucket"]["name"]
    print(f"get file from {links_bucket}: {objectKey}")
    content =s3.get_object(Bucket = links_bucket,Key = objectKey)
    print(f"content: {content['Body'].read()}")
    links = []
    for line in content:
        links.append(line.decode("utf-8"))    
    print(f"links from links_bucket: {links}")

    # Define array to store the links that were not found in the S3 bucket
    links_not_found = []
    
    # Loop through each line and check if link exists in bam files S3 bucket
    for link in list(links):
        if "Contents" not in s3.list_objects_v2(Bucket=BAM_FILES_BUCKET, Prefix=link):
            print(f"{link} not found in S3 bucket {BAM_FILES_BUCKET}")
            links_not_found.append(link)
            links.remove(link)

    # If there are no files to transfer, exit
    if len(links) < 0:
        print("No links found in S3 bucket")
        return { response: "No links found in S3 bucket" }

    # Prepare the pattern for the datasync task inclde filter
    include_pattern = "".join(map("/{0}|".format, links))[:-1]
    print(f"Include pattern: {include_pattern}")
    response = datasync.start_task_execution(
        TaskArn=DATASYNC_TASK_ARN,
        OverrideOptions={},
        Includes=[{"FilterType": "SIMPLE_PATTERN", "Value": include_pattern}],
    )

    # Save the not found links to a file
    print("Saving not found links to log file")
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    with open(f"/tmp/error-{timestamp}.log", "w") as f:
        f.write(f"The following files were not found in the S3 bucket {BAM_FILES_BUCKET}: \n")
        f.write("\n".join(links_not_found))
    
    # Upload the file to S3
    print(f"Uploading error log to {links_bucket}: error/{timestamp}.log")
    s3.upload_file(f"/tmp/error-{timestamp}.log", links_bucket, f"error/{timestamp}.log")

    return {"response": response, "links_not_found": links_not_found}