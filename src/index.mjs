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

let badgeMarkdown = [];

const generateBadgeMarkdown = (text, number, color) => {
  const baseURL = 'https://img.shields.io/static/v1';
  const url = `${baseURL}?label=${encodeURIComponent(text)}&message=${encodeURIComponent(number)}&color=${encodeURIComponent(color)}`;
  const markdownImage = `![${text}](${url})`;
  return markdownImage
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
  // repo count
  const repos = await getRepositories(organization);
  const repoCount = await getRepositoryCount(organization);
  core.info(`Total repositories: ${repoCount}`);

  // pull requests
  let totalOpenPRs = 0;
  let totalMergedPRs = 0;

  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  const prFilterDate = date.toISOString();
  core.debug(`Filtering PRs created after ${prFilterDate}`);

  for (const repo of repos) {
    const { total, merged } = await getPullRequestsCount(organization, repo, prFilterDate);
    totalOpenPRs += total;
    totalMergedPRs += merged;
  }

  core.info(`Total open pull requests in last ${days} days for ${organization}: ${totalOpenPRs}`);
  core.info(`Total merged pull requests in last ${days} days for ${organization}: ${totalMergedPRs}`);

  badgeMarkdown.push(generateBadgeMarkdown(`Total repositories`, repoCount, 'blue'));
  badgeMarkdown.push(generateBadgeMarkdown(`Open PRs in last ${days} days`, totalOpenPRs, 'blue'));
  badgeMarkdown.push(generateBadgeMarkdown(`Merged PRs in last ${days} days`, totalMergedPRs, 'blue'));

  return badgeMarkdown;
};

generateBadges().then(badgeMarkdown => {
  core.info('');
  let badges = badgeMarkdown.join(' ');
  core.info(`Badge markdown: ${badges}`);
  core.setOutput("badges", badges);
}).catch(console.error);
