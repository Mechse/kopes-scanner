#!/usr/bin/env python3
"""Read-only public endpoint probe. No credentials, checkout, or repository execution.
This does not certify private access, token permissions, or self-hosted compatibility.
"""
import json
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

MAX_BYTES = 2_000_000


def read(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'kopes-public-contract-probe', 'Accept': 'application/json'})
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise ValueError('Response exceeds probe limit')
        return json.loads(raw)


def github():
    root = 'https://api.github.com/repos/npm/cli'
    repo = read(root)
    branch = read(root + '/branches/' + urllib.parse.quote(repo['default_branch'], safe=''))
    sha = branch['commit']['sha']
    manifest = read(root + '/contents/package.json?ref=' + sha)
    pulls = read(root + '/pulls?state=closed&per_page=1')
    return {'providerRepositoryId': str(repo['id']), 'public': not repo['private'],
            'commit': sha, 'immutableManifestRead': manifest.get('type') == 'file',
            'blobId': manifest.get('sha'), 'manifestBytes': manifest.get('size'),
            'pullMetadataRead': isinstance(pulls, list), 'sampleCount': len(pulls)}


def gitlab():
    root = 'https://gitlab.com/api/v4/projects/' + urllib.parse.quote('gitlab-org/gitlab', safe='')
    repo = read(root)
    branch = read(root + '/repository/branches/' + urllib.parse.quote(repo['default_branch'], safe=''))
    sha = branch['commit']['id']
    manifest = read(root + '/repository/files/package.json?ref=' + sha)
    mrs = read(root + '/merge_requests?state=merged&per_page=1')
    return {'providerRepositoryId': str(repo['id']), 'public': repo['visibility'] == 'public',
            'commit': sha, 'immutableManifestRead': manifest.get('commit_id') == sha,
            'blobId': manifest.get('blob_id'), 'manifestBytes': manifest.get('size'),
            'mergeRequestMetadataRead': isinstance(mrs, list), 'sampleCount': len(mrs)}


result = {'observedAt': datetime.now(timezone.utc).isoformat(), 'authentication': 'none',
          'limitations': ['Public endpoint contracts only', 'No minimum permission or private repository validation',
                          'No self-hosted GitLab validation', 'No attribution or deployment verification']}
for name, probe in [('github', github), ('gitlabCom', gitlab)]:
    try:
        result[name] = {'ok': True, **probe()}
    except Exception as error:
        result[name] = {'ok': False, 'errorType': type(error).__name__,
                        'httpStatus': getattr(error, 'code', None)}
path = Path(__file__).with_name('public-evidence.json')
path.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
