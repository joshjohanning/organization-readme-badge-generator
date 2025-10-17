# organization-readme-badge-generator

[![GitHub release](https://img.shields.io/github/release/joshjohanning/organization-readme-badge-generator.svg?logo=github&labelColor=333)](https://github.com/joshjohanning/organization-readme-badge-generator/releases)
[![GitHub marketplace](https://img.shields.io/badge/marketplace-github--organization--readme--badge--generator-blue?logo=github&labelColor=333)](https://github.com/marketplace/actions/github-organization-readme-badge-generator)
[![CI](https://github.com/joshjohanning/organization-readme-badge-generator/actions/workflows/ci.yml/badge.svg)](https://github.com/joshjohanning/organization-readme-badge-generator/actions/workflows/ci.yml)
[![Publish GitHub Action](https://github.com/joshjohanning/organization-readme-badge-generator/actions/workflows/publish.yml/badge.svg)](https://github.com/joshjohanning/organization-readme-badge-generator/actions/workflows/publish.yml)
![Coverage](./badges/coverage.svg)

An action to create markdown badges for your GitHub organization's README.md file using shields.io.

## Example

<!-- start organization badges -->

> # my-org-name
>
> ![Total repositories](https://img.shields.io/badge/Total%20repositories-341-blue?labelColor=555) ![PRs created in last 30 days](https://img.shields.io/badge/PRs%20created%20in%20last%2030%20days-29-blue?labelColor=555) ![Merged PRs in last 30 days](https://img.shields.io/badge/Merged%20PRs%20in%20last%2030%20days-12-blue?labelColor=555)

<!-- end organization badges -->

_Live example in my [`joshjohanning-org` org public README](https://github.com/joshjohanning-org#joshjohanning-org)_

## Usage

### Prerequisite

The action runs and generates an output with the markdown badges. There is a sample script provided that runs after the action to inserts the markdown in between two markers in the `profile/README.md` file ([example](https://github.com/joshjohanning-org/.github/blob/main/profile/README.md?plain=1)) and commit the changes if the file has changed.

```md
# my-org-name

<!-- start organization badges -->

<!-- end organization badges -->
```

### Example Workflow

```yml
name: update-organization-readme-badges

on:
  schedule:
    - cron: '0 7 * * *' # runs daily at 07:00
  workflow_dispatch:

permissions:
  contents: write

jobs:
  generate-badges:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/create-github-app-token@v1
        id: app-token
        with:
          app-id: ${{ vars.APP_ID }}
          private-key: ${{ secrets.PRIVATE_KEY }}
          owner: ${{ github.repository_owner }}

      - name: organization-readme-badge-generator
        id: organization-readme-badge-generator
        uses: joshjohanning/organization-readme-badge-generator@v1
        with:
          organization: ${{ github.repository_owner }}
          token: ${{ steps.app-token.outputs.token }} # recommend to use a GitHub App and not a PAT
          color: blue # optional, default is blue
          label_color: '555' # optional, default is 555
          days: 30 # optional, default is 30

      - name: write to job summary
        run: |
          echo "${{ steps.organization-readme-badge-generator.outputs.badges }}" >> $GITHUB_STEP_SUMMARY

      - name: add to readme
        run: |
          readme=profile/README.md

          # get SHA256 before
          beforeHash=$(sha256sum $readme | awk '{ print $1 }')

          # Define start and end markers
          startMarker="<!-- start organization badges -->"
          endMarker="<!-- end organization badges -->"

          replacement="${{ steps.organization-readme-badge-generator.outputs.badges }}"

          # Escape special characters in the replacement text
          replacementEscaped=$(printf '%s\n' "$replacement" | perl -pe 's/([\\\/\$\(\)@])/\\$1/g')

          # Use perl to replace the text between the markers
          perl -i -pe "BEGIN{undef $/;} s/\Q$startMarker\E.*?\Q$endMarker\E/$startMarker\n$replacementEscaped\n$endMarker/smg" $readme
          # get SHA256 after
          afterHash=$(sha256sum $readme | awk '{ print $1 }')
          # Compare the hashes and commit if required
          if [ "$afterHash" = "$beforeHash" ]; then
            echo "The hashes are equal - exiting script"
            exit 0
          else
            git config --global user.name 'github-actions[bot]'
            git config --global user.email 'github-actions[bot]@users.noreply.github.com'
            git add $readme
            git commit -m "docs: update organization readme badges"
            git push
          fi
```

## Inputs

| Input          | Description                                                                                            | Required | Default                          |
| -------------- | ------------------------------------------------------------------------------------------------------ | -------- | -------------------------------- |
| `organization` | The GitHub organization to query                                                                       | Yes      | `${{ github.repository_owner }}` |
| `token`        | PAT or GitHub App token to query the GitHub API                                                        | Yes      | `${{ github.token }}`            |
| `days`         | Number of days to look back for pull request statistics                                                | No       | `30`                             |
| `color`        | Badge color for the message (right side). Supports named colors (blue, green, red, etc.) or hex colors | No       | `blue`                           |
| `label_color`  | Badge color for the label (left side). Supports named colors or hex colors (quote hex values)          | No       | `555`                            |
| `graphql_url`  | The URL to the GitHub GraphQL API endpoint (for GitHub Enterprise)                                     | No       | `https://api.github.com/graphql` |

## Outputs

| Output   | Description                                      |
| -------- | ------------------------------------------------ |
| `badges` | The badge markdown to add to your README.md file |

## Color Options

The `color` and `label_color` parameters support:

- **Named colors**: `brightgreen`, `green`, `yellowgreen`, `yellow`, `orange`, `red`, `blue`, `lightgrey`, etc.
- **Hex colors**: Use quotes for hex values, e.g., `'333'`, `'ff69b4'`, `'007ec6'`
- **RGB colors**: e.g., `'rgb(255,0,0)'`

Examples:

```yaml
color: blue
label_color: '333' # dark gray
```

```yaml
color: brightgreen
label_color: '555' # medium gray
```
