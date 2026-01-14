import { jest } from '@jest/globals';
import core from '@actions/core';
import {
  generateBadgeMarkdown,
  getRepositoryCount,
  getRepositories,
  getPullRequestsCount,
  processPullRequestsInBatches,
  generateBadges,
  validateRequiredInput,
  createGraphqlClient,
  initializeConfig,
  run
} from '../src/index.js';

// Mock @actions/core
jest.spyOn(core, 'info').mockImplementation(() => {});
jest.spyOn(core, 'debug').mockImplementation(() => {});
jest.spyOn(core, 'error').mockImplementation(() => {});
jest.spyOn(core, 'setOutput').mockImplementation(() => {});
jest.spyOn(core, 'getInput').mockImplementation(() => '');

describe('generateBadgeMarkdown', () => {
  it('should generate correct markdown badge with shields.io URL', () => {
    const result = generateBadgeMarkdown('Test Label', 42, 'blue', '555');
    expect(result).toBe('![Test Label](https://img.shields.io/badge/Test%20Label-42-blue?labelColor=555)');
  });

  it('should handle special characters in label', () => {
    const result = generateBadgeMarkdown('Test & Label', 10, 'green', '555');
    expect(result).toBe('![Test & Label](https://img.shields.io/badge/Test%20%26%20Label-10-green?labelColor=555)');
  });

  it('should handle numeric message', () => {
    const result = generateBadgeMarkdown('Count', 0, 'red', '555');
    expect(result).toBe('![Count](https://img.shields.io/badge/Count-0-red?labelColor=555)');
  });

  it('should use custom label color', () => {
    const result = generateBadgeMarkdown('Custom', 5, 'blue', 'red');
    expect(result).toBe('![Custom](https://img.shields.io/badge/Custom-5-blue?labelColor=red)');
  });
});

describe('getRepositoryCount', () => {
  it('should return total repository count', async () => {
    const mockGraphqlClient = jest.fn().mockResolvedValue({
      organization: {
        repositories: {
          totalCount: 42
        }
      }
    });

    const count = await getRepositoryCount('test-org', mockGraphqlClient);

    expect(count).toBe(42);
    expect(mockGraphqlClient).toHaveBeenCalledWith(expect.stringContaining('query ($organization: String!)'), {
      organization: 'test-org'
    });
  });

  it('should handle organization with zero repositories', async () => {
    const mockGraphqlClient = jest.fn().mockResolvedValue({
      organization: {
        repositories: {
          totalCount: 0
        }
      }
    });

    const count = await getRepositoryCount('empty-org', mockGraphqlClient);
    expect(count).toBe(0);
  });

  it('should throw error when graphql fails', async () => {
    const mockGraphqlClient = jest.fn().mockRejectedValue(new Error('GraphQL Error'));

    await expect(getRepositoryCount('test-org', mockGraphqlClient)).rejects.toThrow('GraphQL Error');
  });
});

describe('getRepositories', () => {
  it('should return all repository names with pagination', async () => {
    const mockGraphqlClient = jest
      .fn()
      .mockResolvedValueOnce({
        organization: {
          repositories: {
            nodes: [{ name: 'repo1' }, { name: 'repo2' }],
            pageInfo: {
              endCursor: 'cursor1',
              hasNextPage: true
            }
          }
        }
      })
      .mockResolvedValueOnce({
        organization: {
          repositories: {
            nodes: [{ name: 'repo3' }],
            pageInfo: {
              endCursor: 'cursor2',
              hasNextPage: false
            }
          }
        }
      });

    const repos = await getRepositories('test-org', mockGraphqlClient);

    expect(repos).toEqual(['repo1', 'repo2', 'repo3']);
    expect(mockGraphqlClient).toHaveBeenCalledTimes(2);
  });

  it('should handle single page response', async () => {
    const mockGraphqlClient = jest.fn().mockResolvedValue({
      organization: {
        repositories: {
          nodes: [{ name: 'single-repo' }],
          pageInfo: {
            endCursor: null,
            hasNextPage: false
          }
        }
      }
    });

    const repos = await getRepositories('test-org', mockGraphqlClient);

    expect(repos).toEqual(['single-repo']);
    expect(mockGraphqlClient).toHaveBeenCalledTimes(1);
  });

  it('should handle empty repository list', async () => {
    const mockGraphqlClient = jest.fn().mockResolvedValue({
      organization: {
        repositories: {
          nodes: [],
          pageInfo: {
            endCursor: null,
            hasNextPage: false
          }
        }
      }
    });

    const repos = await getRepositories('test-org', mockGraphqlClient);

    expect(repos).toEqual([]);
  });
});

describe('getPullRequestsCount', () => {
  const filterDate = '2024-01-01';

  it('should count open and merged PRs after filter date', async () => {
    const mockGraphqlClient = jest.fn().mockResolvedValue({
      repository: {
        pullRequests: {
          nodes: [
            {
              createdAt: '2024-01-15T10:00:00Z',
              mergedAt: '2024-01-20T10:00:00Z',
              state: 'MERGED'
            },
            {
              createdAt: '2024-01-10T10:00:00Z',
              mergedAt: null,
              state: 'OPEN'
            },
            {
              createdAt: '2023-12-15T10:00:00Z',
              mergedAt: null,
              state: 'OPEN'
            }
          ],
          pageInfo: {
            endCursor: null,
            hasNextPage: false
          }
        }
      }
    });

    const result = await getPullRequestsCount('test-org', 'test-repo', filterDate, mockGraphqlClient);

    expect(result.total).toBe(2); // 2 PRs created after 2024-01-01
    expect(result.merged).toBe(1); // 1 PR merged after 2024-01-01
  });

  it('should handle pagination for pull requests', async () => {
    const mockGraphqlClient = jest
      .fn()
      .mockResolvedValueOnce({
        repository: {
          pullRequests: {
            nodes: [
              {
                createdAt: '2024-01-15T10:00:00Z',
                mergedAt: '2024-01-20T10:00:00Z',
                state: 'MERGED'
              }
            ],
            pageInfo: {
              endCursor: 'cursor1',
              hasNextPage: true
            }
          }
        }
      })
      .mockResolvedValueOnce({
        repository: {
          pullRequests: {
            nodes: [
              {
                createdAt: '2024-01-10T10:00:00Z',
                mergedAt: null,
                state: 'OPEN'
              }
            ],
            pageInfo: {
              endCursor: null,
              hasNextPage: false
            }
          }
        }
      });

    const result = await getPullRequestsCount('test-org', 'test-repo', filterDate, mockGraphqlClient);

    expect(result.total).toBe(2);
    expect(result.merged).toBe(1);
    expect(mockGraphqlClient).toHaveBeenCalledTimes(2);
  });

  it('should return zero counts when no PRs match filter', async () => {
    const mockGraphqlClient = jest.fn().mockResolvedValue({
      repository: {
        pullRequests: {
          nodes: [
            {
              createdAt: '2023-01-15T10:00:00Z',
              mergedAt: '2023-01-20T10:00:00Z',
              state: 'MERGED'
            }
          ],
          pageInfo: {
            endCursor: null,
            hasNextPage: false
          }
        }
      }
    });

    const result = await getPullRequestsCount('test-org', 'test-repo', filterDate, mockGraphqlClient);

    expect(result.total).toBe(0);
    expect(result.merged).toBe(0);
  });

  it('should handle repository with no pull requests', async () => {
    const mockGraphqlClient = jest.fn().mockResolvedValue({
      repository: {
        pullRequests: {
          nodes: [],
          pageInfo: {
            endCursor: null,
            hasNextPage: false
          }
        }
      }
    });

    const result = await getPullRequestsCount('test-org', 'test-repo', filterDate, mockGraphqlClient);

    expect(result.total).toBe(0);
    expect(result.merged).toBe(0);
  });
});

describe('processPullRequestsInBatches', () => {
  const filterDate = '2024-01-01';

  it('should process multiple repositories in batches', async () => {
    const mockGraphqlClient = jest
      .fn()
      // repo1
      .mockResolvedValueOnce({
        repository: {
          pullRequests: {
            nodes: [
              {
                createdAt: '2024-01-15T10:00:00Z',
                mergedAt: '2024-01-20T10:00:00Z',
                state: 'MERGED'
              }
            ],
            pageInfo: { endCursor: null, hasNextPage: false }
          }
        }
      })
      // repo2
      .mockResolvedValueOnce({
        repository: {
          pullRequests: {
            nodes: [
              {
                createdAt: '2024-01-10T10:00:00Z',
                mergedAt: null,
                state: 'OPEN'
              }
            ],
            pageInfo: { endCursor: null, hasNextPage: false }
          }
        }
      });

    const repos = ['repo1', 'repo2'];
    const result = await processPullRequestsInBatches('test-org', repos, filterDate, mockGraphqlClient, 10);

    expect(result.totalOpenPRs).toBe(2);
    expect(result.totalMergedPRs).toBe(1);
    expect(mockGraphqlClient).toHaveBeenCalledTimes(2);
  });

  it('should process repositories in multiple batches', async () => {
    const mockGraphqlClient = jest
      .fn()
      // batch 1: repo1, repo2
      .mockResolvedValueOnce({
        repository: {
          pullRequests: {
            nodes: [
              {
                createdAt: '2024-01-15T10:00:00Z',
                mergedAt: '2024-01-20T10:00:00Z',
                state: 'MERGED'
              }
            ],
            pageInfo: { endCursor: null, hasNextPage: false }
          }
        }
      })
      .mockResolvedValueOnce({
        repository: {
          pullRequests: {
            nodes: [
              {
                createdAt: '2024-01-10T10:00:00Z',
                mergedAt: null,
                state: 'OPEN'
              }
            ],
            pageInfo: { endCursor: null, hasNextPage: false }
          }
        }
      })
      // batch 2: repo3
      .mockResolvedValueOnce({
        repository: {
          pullRequests: {
            nodes: [
              {
                createdAt: '2024-01-12T10:00:00Z',
                mergedAt: '2024-01-14T10:00:00Z',
                state: 'MERGED'
              }
            ],
            pageInfo: { endCursor: null, hasNextPage: false }
          }
        }
      });

    const repos = ['repo1', 'repo2', 'repo3'];
    const result = await processPullRequestsInBatches('test-org', repos, filterDate, mockGraphqlClient, 2);

    expect(result.totalOpenPRs).toBe(3);
    expect(result.totalMergedPRs).toBe(2);
    expect(mockGraphqlClient).toHaveBeenCalledTimes(3);
  });

  it('should handle empty repository list', async () => {
    const mockGraphqlClient = jest.fn();
    const repos = [];
    const result = await processPullRequestsInBatches('test-org', repos, filterDate, mockGraphqlClient, 10);

    expect(result.totalOpenPRs).toBe(0);
    expect(result.totalMergedPRs).toBe(0);
    expect(mockGraphqlClient).not.toHaveBeenCalled();
  });

  it('should use default batch size of 10', async () => {
    const mockGraphqlClient = jest.fn().mockResolvedValue({
      repository: {
        pullRequests: {
          nodes: [],
          pageInfo: { endCursor: null, hasNextPage: false }
        }
      }
    });

    const repos = Array.from({ length: 25 }, (_, i) => `repo${i}`);
    await processPullRequestsInBatches('test-org', repos, filterDate, mockGraphqlClient);

    // With batch size 10, should process all 25 repos concurrently in 3 batches
    expect(mockGraphqlClient).toHaveBeenCalledTimes(25);
  });

  it('should aggregate PR counts correctly across batches', async () => {
    const mockGraphqlClient = jest.fn().mockImplementation((_, { repo }) => {
      // repo1 and repo2 have PRs, others don't
      if (repo === 'repo1' || repo === 'repo2') {
        return Promise.resolve({
          repository: {
            pullRequests: {
              nodes: [
                {
                  createdAt: '2024-01-15T10:00:00Z',
                  mergedAt: '2024-01-20T10:00:00Z',
                  state: 'MERGED'
                }
              ],
              pageInfo: { endCursor: null, hasNextPage: false }
            }
          }
        });
      }
      return Promise.resolve({
        repository: {
          pullRequests: {
            nodes: [],
            pageInfo: { endCursor: null, hasNextPage: false }
          }
        }
      });
    });

    const repos = ['repo1', 'repo2', 'repo3', 'repo4'];
    const result = await processPullRequestsInBatches('test-org', repos, filterDate, mockGraphqlClient, 2);

    expect(result.totalOpenPRs).toBe(2);
    expect(result.totalMergedPRs).toBe(2);
  });

  it('should propagate errors when an API call fails within a batch', async () => {
    const mockError = new Error('API rate limit exceeded');
    const mockGraphqlClient = jest
      .fn()
      .mockResolvedValueOnce({
        repository: {
          pullRequests: {
            nodes: [],
            pageInfo: { endCursor: null, hasNextPage: false }
          }
        }
      })
      .mockRejectedValueOnce(mockError);

    const repos = ['repo1', 'repo2'];
    await expect(processPullRequestsInBatches('test-org', repos, filterDate, mockGraphqlClient, 10)).rejects.toThrow(
      'API rate limit exceeded'
    );
  });
});

describe('generateBadges', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should generate all badges for an organization', async () => {
    const mockGraphqlClient = jest
      .fn()
      // getRepositories call
      .mockResolvedValueOnce({
        organization: {
          repositories: {
            nodes: [{ name: 'repo1' }, { name: 'repo2' }],
            pageInfo: {
              endCursor: null,
              hasNextPage: false
            }
          }
        }
      })
      // getPullRequestsCount for repo1
      .mockResolvedValueOnce({
        repository: {
          pullRequests: {
            nodes: [
              {
                createdAt: '2024-01-15T10:00:00Z',
                mergedAt: '2024-01-20T10:00:00Z',
                state: 'MERGED'
              }
            ],
            pageInfo: {
              endCursor: null,
              hasNextPage: false
            }
          }
        }
      })
      // getPullRequestsCount for repo2
      .mockResolvedValueOnce({
        repository: {
          pullRequests: {
            nodes: [
              {
                createdAt: '2024-01-10T10:00:00Z',
                mergedAt: null,
                state: 'OPEN'
              }
            ],
            pageInfo: {
              endCursor: null,
              hasNextPage: false
            }
          }
        }
      });

    const badges = await generateBadges('test-org', 'token', 30, mockGraphqlClient, 'blue', '555');

    expect(badges).toHaveLength(3);
    expect(badges[0]).toContain('Total repositories');
    expect(badges[0]).toContain('https://img.shields.io/badge/');
    expect(badges[1]).toContain('PRs created in last 30 days');
    expect(badges[2]).toContain('Merged PRs in last 30 days');
    expect(core.info).toHaveBeenCalledWith('Total repositories: 2');
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Total pull requests created'));
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Total merged pull requests'));
  });

  it('should handle organization with no repositories', async () => {
    const mockGraphqlClient = jest
      .fn()
      // getRepositories call
      .mockResolvedValueOnce({
        organization: {
          repositories: {
            nodes: [],
            pageInfo: {
              endCursor: null,
              hasNextPage: false
            }
          }
        }
      });

    const badges = await generateBadges('empty-org', 'token', 30, mockGraphqlClient, 'blue', '555');

    expect(badges).toHaveLength(3);
    expect(badges[0]).toContain('https://img.shields.io/badge/');
    expect(badges[1]).toContain('PRs created in last 30 days');
    expect(badges[1]).toContain('https://img.shields.io/badge/');
  });

  it('should handle errors in generateBadges', async () => {
    const mockGraphqlClient = jest.fn().mockRejectedValue(new Error('GraphQL API Error'));

    // Mock process.exit to prevent test from exiting
    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    await expect(generateBadges('test-org', 'token', 30, mockGraphqlClient, 'blue', '555')).rejects.toThrow(
      'process.exit called'
    );

    expect(core.error).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(1);

    mockExit.mockRestore();
  });

  it('should use default colors when not provided', async () => {
    const mockGraphqlClient = jest
      .fn()
      .mockResolvedValueOnce({
        organization: {
          repositories: {
            nodes: [{ name: 'repo1' }],
            pageInfo: { endCursor: null, hasNextPage: false }
          }
        }
      })
      .mockResolvedValueOnce({
        repository: {
          pullRequests: {
            nodes: [],
            pageInfo: { endCursor: null, hasNextPage: false }
          }
        }
      });

    const badges = await generateBadges('test-org', 'token', 30, mockGraphqlClient);

    expect(badges).toHaveLength(3);
    expect(badges[0]).toContain('https://img.shields.io/badge/');
  });

  it('should use default days when not provided', async () => {
    const mockGraphqlClient = jest
      .fn()
      .mockResolvedValueOnce({
        organization: {
          repositories: {
            nodes: [{ name: 'repo1' }],
            pageInfo: { endCursor: null, hasNextPage: false }
          }
        }
      })
      .mockResolvedValueOnce({
        repository: {
          pullRequests: {
            nodes: [],
            pageInfo: { endCursor: null, hasNextPage: false }
          }
        }
      });

    const badges = await generateBadges('test-org', 'token', null, mockGraphqlClient, 'blue', '555');

    expect(badges).toHaveLength(3);
    expect(badges[1]).toContain('PRs created in last 30 days');
  });
});

describe('validateRequiredInput', () => {
  it('should return value when input is provided', () => {
    const result = validateRequiredInput('test-org', 'organization');
    expect(result).toBe('test-org');
  });

  it('should throw error when input is missing', () => {
    expect(() => validateRequiredInput('', 'organization')).toThrow('organization is required');
  });

  it('should throw error when input is null', () => {
    expect(() => validateRequiredInput(null, 'token')).toThrow('token is required');
  });

  it('should throw error when input is undefined', () => {
    expect(() => validateRequiredInput(undefined, 'days')).toThrow('days is required');
  });
});

describe('createGraphqlClient', () => {
  it('should create a graphql client with default URL', () => {
    const client = createGraphqlClient('test-token');
    expect(client).toBeDefined();
    expect(typeof client).toBe('function');
  });

  it('should create a graphql client with custom URL', () => {
    const client = createGraphqlClient('test-token', 'https://custom.github.com/graphql');
    expect(client).toBeDefined();
    expect(typeof client).toBe('function');
  });

  it('should create a graphql client when custom URL matches default', () => {
    const client = createGraphqlClient('test-token', 'https://api.github.com/graphql');
    expect(client).toBeDefined();
    expect(typeof client).toBe('function');
  });
});

describe('run', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should execute with provided config and set outputs', async () => {
    const mockGraphqlClient = jest
      .fn()
      .mockResolvedValueOnce({
        organization: {
          repositories: {
            nodes: [{ name: 'repo1' }],
            pageInfo: { endCursor: null, hasNextPage: false }
          }
        }
      })
      .mockResolvedValueOnce({
        repository: {
          pullRequests: {
            nodes: [],
            pageInfo: { endCursor: null, hasNextPage: false }
          }
        }
      });

    const config = {
      organization: 'test-org',
      token: 'test-token',
      days: 30,
      graphqlClient: mockGraphqlClient,
      color: 'blue',
      labelColor: '555'
    };

    const badges = await run(config);

    expect(badges).toHaveLength(3);
    expect(core.setOutput).toHaveBeenCalledWith('badges', expect.any(String));
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Badge markdown:'));
  });

  it('should handle errors during execution', async () => {
    const mockGraphqlClient = jest.fn().mockRejectedValue(new Error('API Error'));

    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    const config = {
      organization: 'test-org',
      token: 'test-token',
      days: 30,
      graphqlClient: mockGraphqlClient,
      color: 'blue',
      labelColor: '555'
    };

    await expect(run(config)).rejects.toThrow('process.exit called');
    expect(core.error).toHaveBeenCalled();

    mockExit.mockRestore();
  });
});

describe('initializeConfig', () => {
  let getInputSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    getInputSpy = jest.spyOn(core, 'getInput');
  });

  afterEach(() => {
    getInputSpy.mockRestore();
  });

  it('should throw error when organization is missing', () => {
    getInputSpy.mockReturnValue('');
    expect(() => initializeConfig()).toThrow('organization is required');
  });

  it('should throw error when token is missing', () => {
    getInputSpy.mockImplementation(name => {
      if (name === 'organization') return 'test-org';
      return '';
    });
    expect(() => initializeConfig()).toThrow('token is required');
  });

  it('should return config with default values when inputs provided', () => {
    getInputSpy.mockImplementation(name => {
      if (name === 'organization') return 'test-org';
      if (name === 'token') return 'test-token';
      return '';
    });

    const config = initializeConfig();

    expect(config.organization).toBe('test-org');
    expect(config.token).toBe('test-token');
    expect(config.days).toBe(30);
    expect(config.graphqlUrl).toBe('https://api.github.com/graphql');
    expect(config.color).toBe('blue');
    expect(config.labelColor).toBe('555');
    expect(config.graphqlClient).toBeDefined();
  });

  it('should use custom values when provided', () => {
    getInputSpy.mockImplementation(name => {
      if (name === 'organization') return 'custom-org';
      if (name === 'token') return 'custom-token';
      if (name === 'days') return '60';
      if (name === 'graphql_url') return 'https://custom.github.com/graphql';
      if (name === 'color') return 'green';
      if (name === 'label_color') return '999';
      return '';
    });

    const config = initializeConfig();

    expect(config.organization).toBe('custom-org');
    expect(config.token).toBe('custom-token');
    expect(config.days).toBe('60');
    expect(config.graphqlUrl).toBe('https://custom.github.com/graphql');
    expect(config.color).toBe('green');
    expect(config.labelColor).toBe('999');
  });
});
