# Backend Starter repository

This repository contains the AWS canaries infrastrucure to roll-out a new synthetics health check or
end to end test. 

## Folder structure
- the code for canaries are insdie the `src` folder.
- `.circleci` contains circleCI setup

## To add a new test.
- create a new test file inside `src` folder with the format `src/<your_test_folder>/nodejs/node_modules/index.ts`
- in main.ts, create a new `Canary` resource by passing the canary `name` and set the `source` to the `dist/<your_test_folder>` as a relative path from `cdk.tf.json` file.
- to access secretStore for testCredentials, we can directly use the aws-sdk inside the index.ts file.

## Develop Locally
```bash
npm install
npm run build:dev
cd cdktf.out/stacks/canary-tests/
terraform login
terraform init
terraform plan/apply
```
