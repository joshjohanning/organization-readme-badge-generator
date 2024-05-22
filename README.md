# organization-readme-badge-generator

An action to create markdown badges for your GitHub organization's README.md file using Shields.io.

## Usage

The action runs and generates an output with the markdown badges. There is a sample script provided that runs after the action to inserts the markdown in between two markers in the `profile/README.md` file and commit the changes if the file has changed.

```md
<!-- start organization badges -->

<!-- end organization badges -->
```

```yaml
name: update-organization-readme-badges

on:
  schedule:
    - cron: '0 7 * * *' # runs daily at 07:00
  workflow_dispatch:

jobs:
  generate-badges:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4
  
      - name: organization-readme-badge-generator
        id: organization-readme-badge-generator
        uses: joshjohanning/organization-readme-badge-generator@v1
        with:
          organization: ${{ github.repository_owner }}
          token: ${{ secrets.ADMIN_TOKEN }} # recommend to use a GitHub App and not a PAT

```yaml
    steps:
      - uses: actions/checkout@v4
  
      - name: organization-readme-badge-generator
        id: organization-readme-badge-generator
        uses: joshjohanning/organization-readme-badge-generator@v1
        with:
          organization: ${{ github.repository_owner }}
          token: ${{ secrets.ADMIN_TOKEN }} # recommend to use a GitHub App and not a PAT
    
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

## Example

<!-- start organization badges -->
![Total repositories](https://img.shields.io/static/v1?label=Total%20repositories&message=341&color=blue) ![Open PRs in last 30 days](https://img.shields.io/static/v1?label=Open%20PRs%20in%20last%2030%20days&message=29&color=blue) ![Merged PRs in last 30 days](https://img.shields.io/static/v1?label=Merged%20PRs%20in%20last%2030%20days&message=2&color=blue)
<!-- end organization badges -->
