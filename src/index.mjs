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

let badgeURLs = [];
const generateBadgeURL = (text, number, color) => {
  const baseURL = 'https://img.shields.io/static/v1';
  const url = `${baseURL}?label=${encodeURIComponent(text)}&message=${encodeURIComponent(number)}&color=${encodeURIComponent(color)}`;
  return url;
};

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

// get repositories
const getRepositories = async (org) => {
  let endCursor;
  let hasNextPage = true;
  const repositories = [];

  while (hasNextPage) {
    const { organization } = await graphqlWithAuth(`
      query ($organization: String!, $after: String) {
        organization (login: $organization) {
          repositories(last: 30, after: $after) {
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

// get pull request open and merged count
const getPullRequestsCount = async (org, repo, prFilterDate) => {
  let endCursor;
  let hasNextPage = true;
  let total = 0, merged = 0;

  while (hasNextPage) {
    const { repository } = await graphqlWithAuth(`
      query ($org: String!, $repo: String!, $after: String) {
        repository(owner: $org, name: $repo) {
          pullRequests(first: 100, after: $after) {
            nodes {
              createdAt
              mergedAt
              state
            }
            pageInfo {
              endCursor
              hasNextPage
            }
          }
        }
      }
    `, { org, repo, after: endCursor });

    const pullRequests = repository.pullRequests.nodes

    const openPullRequests = repository.pullRequests.nodes.filter(pr => new Date(pr.createdAt).toISOString().slice(0, 10) >= prFilterDate);
    total += openPullRequests.length;

    const mergedPRs = pullRequests.filter(pr => pr.state === 'MERGED' && new Date(pr.mergedAt).toISOString().slice(0, 10) >= prFilterDate);
    merged += mergedPRs.length;

    // TODO: Do we want closed (aka not merged) PRs?

    hasNextPage = repository.pullRequests.pageInfo.hasNextPage;
    endCursor = repository.pullRequests.pageInfo.endCursor;
  }

  return {
    total,
    merged
  };
};

Promise.all([
  // return repo count
  getRepositoryCount(organization).then(count => {
    console.log(`Total repositories: ${count}`);
    const reposTotalBadgeUrl = generateBadgeURL(`Total repositories`, count, 'blue');
    badgeURLs.push(reposTotalBadgeUrl);
  }),
  // return open and merged PRs
  getRepositories(organization).then(async repos => {
    let totalOpenPRs = 0;
    let totalMergedPRs = 0;

    const date = new Date();
    date.setUTCDate(date.getUTCDate() - days);
    const prFilterDate = date.toISOString();
    console.log(`Date 30 days ago in UTC: ${prFilterDate}`);

    for (const repo of repos) {
      const { total, merged } = await getPullRequestsCount(organization, repo, prFilterDate);
      totalOpenPRs += total;
      totalMergedPRs += merged;
    }

    console.log(`Total open pull requests in last ${days} days for ${organization}: ${totalOpenPRs}`);
    console.log(`Total merged pull requests in last ${days} days for ${organization}: ${totalMergedPRs}`);
    const openPRsBadgeURL = generateBadgeURL(`Open PRs in last ${days} days`, totalOpenPRs, 'blue');
    badgeURLs.push(openPRsBadgeURL);
    const mergedPRsBadgeURL = generateBadgeURL(`Merged PRs in last ${days} days`, totalMergedPRs, 'blue');
    badgeURLs.push(mergedPRsBadgeURL);
  })
]).then(() => {
  console.log(badgeURLs);
}).catch(console.error);


// TODO: handle secondary rate limit error with retries? 

// TODO: take the results and create them as an output
// TODO: create function for markdown badges

// console.log(badgeURLs);
