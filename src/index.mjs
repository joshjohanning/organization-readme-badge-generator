import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";
import core from "@actions/core";
import { graphql } from "@octokit/graphql";

const argv = yargs(hideBin(process.argv)).argv;

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

    const openPullRequests = pullRequests.filter(pr => new Date(pr.createdAt).toISOString().slice(0, 10) >= prFilterDate);
    total += openPullRequests.length;

    const mergedPRs = pullRequests.filter(pr => pr.state === 'MERGED' && new Date(pr.mergedAt).toISOString().slice(0, 10) >= prFilterDate);
    merged += mergedPRs.length;

    hasNextPage = repository.pullRequests.pageInfo.hasNextPage;
    endCursor = repository.pullRequests.pageInfo.endCursor;
  }

  return {
    total,
    merged
  };
};

const generateBadges = async () => {
  const repos = await getRepositories(organization);
  const repoCount = await getRepositoryCount(organization);
  let totalOpenPRs = 0;
  let totalMergedPRs = 0;

  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  const prFilterDate = date.toISOString();

  for (const repo of repos) {
    const { total, merged } = await getPullRequestsCount(organization, repo, prFilterDate);
    totalOpenPRs += total;
    totalMergedPRs += merged;
  }

  badgeURLs.push(generateBadgeURL(`Total repositories`, repoCount, 'blue'));
  badgeURLs.push(generateBadgeURL(`Open PRs in last ${days} days`, totalOpenPRs, 'blue'));
  badgeURLs.push(generateBadgeURL(`Merged PRs in last ${days} days`, totalMergedPRs, 'blue'));

  return badgeURLs;
};

generateBadges().then(badgeURLs => {
  console.log(badgeURLs);
}).catch(console.error);
