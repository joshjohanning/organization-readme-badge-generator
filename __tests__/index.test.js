import { jest } from '@jest/globals';
import core from '@actions/core';
import {
  generateBadgeMarkdown,
  getRepositoryCount,
  getRepositories,
  getPullRequestsCount,
  generateBadges,
  validateRequiredInput
} from '../src/index.js';

// Mock @actions/core
jest.spyOn(core, 'info').mockImplementation(() => {});
jest.spyOn(core, 'debug').mockImplementation(() => {});
jest.spyOn(core, 'error').mockImplementation(() => {});
jest.spyOn(core, 'setOutput').mockImplementation(() => {});

describe('generateBadgeMarkdown', () => {
  it('should generate correct markdown badge with SVG data URI', () => {
    const result = generateBadgeMarkdown('Test Label', 42, 'blue', '555');
    expect(result).toContain('![Test Label](data:image/svg+xml;base64,');
    expect(result).toMatch(/data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+\)/);
  });

  it('should handle special characters in label', () => {
    const result = generateBadgeMarkdown('Test & Label', 10, 'green', '555');
    expect(result).toContain('![Test & Label](data:image/svg+xml;base64,');
    expect(result).toMatch(/data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+\)/);
  });

  it('should handle numeric message', () => {
    const result = generateBadgeMarkdown('Count', 0, 'red', '555');
    expect(result).toContain('![Count](data:image/svg+xml;base64,');
    expect(result).toMatch(/data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+\)/);
  });

  it('should use custom label color', () => {
    const result = generateBadgeMarkdown('Custom', 5, 'blue', 'red');
    expect(result).toContain('![Custom](data:image/svg+xml;base64,');
    expect(result).toMatch(/data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+\)/);
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
      // getRepositoryCount call
      .mockResolvedValueOnce({
        organization: {
          repositories: {
            totalCount: 2
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
    expect(badges[0]).toContain('data:image/svg+xml;base64,');
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
    expect(badges[0]).toContain('data:image/svg+xml;base64,');
    expect(badges[1]).toContain('PRs created in last 30 days');
    expect(badges[1]).toContain('data:image/svg+xml;base64,');
  });

  it('should handle errors in generateBadges', async () => {
    const mockGraphqlClient = jest.fn().mockRejectedValue(new Error('GraphQL API Error'));

    // Mock process.exit to prevent test from exiting
    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {});

    await generateBadges('test-org', 'token', 30, mockGraphqlClient, 'blue', '555');

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
        organization: {
          repositories: { totalCount: 1 }
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
    expect(badges[0]).toContain('data:image/svg+xml;base64,');
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
