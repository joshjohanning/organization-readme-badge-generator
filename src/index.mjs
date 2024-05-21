import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";
import core from "@actions/core";
import { graphql } from "@octokit/graphql";

const argv = yargs(hideBin(process.argv)).argv;

// call via node convert-json-to-markdown.js --organization=joshjohanning-org --token=ghp_abc

const organization = argv.organization || core.getInput("organization", { required: true });
const token = argv.token || core.getInput("token", { required: true });
const days = argv.days || core.getInput("days", { required: false }) || 30;

const graphqlWithAuth = graphql.defaults({
  headers: {
    authorization: `token ${token}`,
  },
});

// get repository count
const getRepositoryCount = async (org) => {
  const { organization } = await graphqlWithAuth(`
    query ($organization: String!) {
      organization (login: $organization) {
        repositories {
          totalCount
        }
      }
    }
  `, { organization: org });

  return organization.repositories.totalCount;
};

getRepositoryCount(organization).then(count => {
  console.log(`Total repositories: ${count}`);
}).catch(console.error);

// get repositories
const getRepositories = async (org) => {
  let endCursor;
  let hasNextPage = true;
  const repositories = [];

  while (hasNextPage) {
    const { organization } = await graphqlWithAuth(`
      query ($organization: String!, $after: String) {
        organization (login: $organization) {
          repositories(first: 100, after: $after) {
            nodes {
              name
            }
            pageInfo {
              endCursor
              hasNextPage
            }
          }
        }
      }
    `, { organization: org, after: endCursor });

    repositories.push(...organization.repositories.nodes.map(repo => repo.name));

    hasNextPage = organization.repositories.pageInfo.hasNextPage;
    endCursor = organization.repositories.pageInfo.endCursor;
  }

  return repositories;
};

// get pull request open and merged count - we have to do 2 separate queries b/c pagination
const getPullRequestsCount = async (org, repo) => {
  let endCursorPR, endCursorMergedPR;
  let hasNextPagePR = true, hasNextPageMergedPR = true;
  let total = 0, merged = 0;

  // Get the date 30 days ago
  const date30DaysAgo = new Date();
  date30DaysAgo.setDate(date30DaysAgo.getDate() - 30);

  while (hasNextPagePR) {
    const { repository } = await graphqlWithAuth(`
      query ($org: String!, $repo: String!, $after: String) {
        repository(owner: $org, name: $repo) {
          pullRequests(first: 100, after: $after) {
            nodes {
              createdAt
            }
            pageInfo {
              endCursor
              hasNextPage
            }
          }
        }
      }
    `, { org, repo, after: endCursorPR });

    total += repository.pullRequests.nodes.filter(pr => new Date(pr.createdAt) >= date30DaysAgo).length;
    hasNextPagePR = repository.pullRequests.pageInfo.hasNextPage;
    endCursorPR = repository.pullRequests.pageInfo.endCursor;
  }

  while (hasNextPageMergedPR) {
    const { repository } = await graphqlWithAuth(`
      query ($org: String!, $repo: String!, $after: String) {
        repository(owner: $org, name: $repo) {
          mergedPullRequests: pullRequests(states: MERGED, first: 100, after: $after) {
            nodes {
              createdAt
            }
            pageInfo {
              endCursor
              hasNextPage
            }
          }
        }
      }
    `, { org, repo, after: endCursorMergedPR });

    merged += repository.mergedPullRequests.nodes.filter(pr => new Date(pr.createdAt) >= date30DaysAgo).length;
    hasNextPageMergedPR = repository.mergedPullRequests.pageInfo.hasNextPage;
    endCursorMergedPR = repository.mergedPullRequests.pageInfo.endCursor;
  }

  return {
    total,
    merged
  };
};

getRepositories(organization).then(async repos => {
  let totalOpenPRs = 0;
  let totalMergedPRs = 0;

  for (const repo of repos) {
    const { total, merged } = await getPullRequestsCount(organization, repo);
    totalOpenPRs += total;
    totalMergedPRs += merged;
  }

  console.log(`Total open pull requests in last ${days} days for ${organization}: ${totalOpenPRs}`);
  console.log(`Total merged pull requests in last ${days} days for ${organization}: ${totalMergedPRs}`);
}).catch(console.error);

// TODO: handle secondary rate limit error with retries? 
