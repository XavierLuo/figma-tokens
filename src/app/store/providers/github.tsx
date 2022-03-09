import { useDispatch, useSelector } from 'react-redux';
import { Octokit } from '@octokit/rest';
import { Dispatch, RootState } from '@/app/store';
import { MessageToPluginTypes } from '@/types/messages';
import { TokenProps } from '@/types/tokens';
import convertTokensToObject from '@/utils/convertTokensToObject';
import useConfirm from '@/app/hooks/useConfirm';
import usePushDialog from '@/app/hooks/usePushDialog';
import IsJSONString from '@/utils/isJSONString';
import { ContextObject } from '@/types/api';
import { notifyToUI, postToFigma } from '../../../plugin/notifiers';

/** Returns a URL to a page where the user can create a pull request with a given branch */
export function getCreatePullRequestUrl(id: string, branchName: string) {
  return `https://github.com/${id}/compare/${branchName}?expand=1`;
}

function hasSameContent(content, storedContent) {
  const stringifiedContent = JSON.stringify(content.values, null, 2);

  return stringifiedContent === storedContent;
}

export const fetchBranches = async ({ context, owner, repo }) => {
  const octokit = new Octokit({ auth: context.secret, baseUrl: context.baseUrl });
  const branches = await octokit.repos.listBranches({ owner, repo }).then((response) => response.data);
  return branches.map((branch) => branch.name);
};

export const checkPermissions = async ({ context, owner, repo }) => {
  try {
    const octokit = new Octokit({ auth: context.secret, baseUrl: context.baseUrl });

    const currentUser = await octokit.rest.users.getAuthenticated();

    if (!currentUser.data.login) return null;

    const permissions = await octokit.rest.repos.getCollaboratorPermissionLevel({
      owner,
      repo,
      username: currentUser.data.login,
    });

    return permissions;
  } catch (e) {
    console.log(e);

    return null;
  }
};

function getTreeMode(type) {
  switch (type) {
    case 'dir':
      return '040000';
    default:
      return '100644';
  }
}

export const readContents = async ({ context, owner, repo }) => {
  const octokit = new Octokit({ auth: context.secret, baseUrl: context.baseUrl });
  let response;

  try {
    response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: context.filePath,
      ref: context.branch,
    });
    const fileContents: Array<{ name: string, data: string }> = [];
    if (Array.isArray(response.data)) {
      console.log('Resposne data', response.data);
      const folderResponse = await octokit.rest.git.createTree({ owner, repo, tree: response.data.map((item) => ({ path: item.path, sha: item.sha, mode: getTreeMode(item.type) })) });
      console.log('Folder response', folderResponse);
      if (folderResponse.data.tree[0].sha) {
        const treeResponse = await octokit.rest.git.getTree({
          owner, repo, tree_sha: folderResponse.data.tree[0].sha, recursive: 'true',
        });
        console.log('Tree response', treeResponse);
        if (treeResponse.data.tree.length > 0) {
          await Promise.all(
            treeResponse.data.tree.filter((i) => i.path?.endsWith('.json')).map((treeItem) => {
              console.log('Got tree item', treeItem);
              if (treeItem.path) {
                return octokit.rest.repos.getContent({
                  owner,
                  repo,
                  path: `${context.filePath}/${treeItem.path}`,
                  ref: context.branch,
                }).then((res) => {
                  console.log('Res', res.data);
                  if (res.data.content) {
                    fileContents.push({ name: treeItem.path.replace('.json', ''), data: atob(res.data.content) });
                  }
                });
              }
              return null;
            }),
          );
        }
      }
    } else if (response.data.content) {
      fileContents.push({ name: response.data.name, data: atob(response.data.content) });
    }
    console.log('file contents', fileContents);
    if (fileContents.length > 0) {
      console.log('file cont', fileContents);
      const allContents = fileContents.reduce((acc, curr) => {
        if (IsJSONString(curr.data)) {
          const parsed = JSON.parse(curr.data);
          console.log('parsed', curr.name, parsed);

          acc[curr.name] = parsed;
        }
        return acc;
      }, {});
      console.log('All contents', allContents);
      return { values: allContents };
      // If content of file is parseable JSON, parse it

      return null;
    }
    // If not, return null as we can't process that file. We should let the user know, though.
    return null;
  } catch (e) {
    // Raise error (usually this is an auth error)
    console.log('Error', e);
    return null;
  }
};

const commitToNewBranch = async ({
  context, tokenObj, owner, repo, commitMessage, branch,
}) => {
  const OctokitWithPlugin = Octokit.plugin(require('octokit-commit-multiple-files'));
  const octokit = new OctokitWithPlugin({ auth: context.secret, baseUrl: context.baseUrl });

  return octokit.repos.createOrUpdateFiles({
    owner,
    repo,
    branch,
    createBranch: true,
    changes: [{ message: commitMessage || 'Commit from Figma', files: { [context.filePath]: tokenObj } }],
  });
};

const commitToExistingBranch = async ({
  context, tokenObj, owner, repo, commitMessage, branch,
}) => {
  const OctokitWithPlugin = Octokit.plugin(require('octokit-commit-multiple-files'));
  const octokit = new OctokitWithPlugin({ auth: context.secret, baseUrl: context.baseUrl });
  return octokit.repos.createOrUpdateFiles({
    owner,
    repo,
    branch,
    createBranch: false,
    changes: [{ message: commitMessage || 'Commit from Figma', files: { [context.filePath]: tokenObj } }],
  });
};

export function useGitHub() {
  const { tokens } = useSelector((state: RootState) => state.tokenState);
  const { localApiState } = useSelector((state: RootState) => state.uiState);
  const dispatch = useDispatch<Dispatch>();

  const { confirm } = useConfirm();
  const { pushDialog } = usePushDialog();

  async function askUserIfPull(): Promise<boolean> {
    const { result } = await confirm({
      text: 'Pull from GitHub?',
      description: 'Your repo already contains tokens, do you want to pull these now?',
    });
    return result;
  }

  function getTokenObj() {
    const raw = convertTokensToObject(tokens);
    const string = JSON.stringify(raw, null, 2);
    return { raw, string };
  }

  async function writeTokensToGitHub({
    context,
    tokenObj,
    owner,
    repo,
    commitMessage,
    customBranch,
  }: {
    context: ContextObject;
    tokenObj: string;
    owner: string;
    repo: string;
    commitMessage?: string;
    customBranch?: string;
  }): Promise<TokenProps | null> {
    try {
      const branches = await fetchBranches({ context, owner, repo });
      const branch = customBranch || context.branch;
      if (!branches) return null;
      if (branches.includes(branch)) {
        await commitToExistingBranch({
          context,
          tokenObj,
          owner,
          repo,
          commitMessage,
          branch,
        });
      } else {
        await commitToNewBranch({
          context,
          tokenObj,
          owner,
          repo,
          commitMessage,
          branch,
        });
      }
      dispatch.tokenState.setLastSyncedState(tokenObj);
      notifyToUI('Pushed changes to GitHub');
    } catch (e) {
      notifyToUI('Error pushing to GitHub');
      console.log('Error pushing to GitHub', e);
      return null;
    }
  }

  async function pushTokensToGitHub(context) {
    const { raw: rawTokenObj, string: tokenObj } = getTokenObj();
    const [owner, repo] = context.id.split('/');

    const content = await readContents({ context, owner, repo });
    if (content) {
      if (content && hasSameContent(content, tokenObj)) {
        notifyToUI('Nothing to commit');
        return rawTokenObj;
      }
    }

    dispatch.uiState.setLocalApiState({ ...context });

    const pushSettings = await pushDialog();
    if (pushSettings) {
      const { commitMessage, customBranch } = pushSettings;
      try {
        await writeTokensToGitHub({
          context,
          tokenObj,
          owner,
          repo,
          commitMessage,
          customBranch,
        });
        dispatch.uiState.setLocalApiState({ ...localApiState, branch: customBranch });
        dispatch.uiState.setApiData({ ...context, branch: customBranch });

        pushDialog('success');
      } catch (e) {
        console.log('Error pushing to GitHub', e);
      }
    }
    return rawTokenObj;
  }

  async function checkAndSetAccess({ context, owner, repo }) {
    const hasWriteAccess = await checkPermissions({ context, owner, repo });
    dispatch.tokenState.setEditProhibited(!hasWriteAccess);
  }

  async function pullTokensFromGitHub(context) {
    const [owner, repo] = context.id.split('/');

    await checkAndSetAccess({ context, owner, repo });

    try {
      const content = await readContents({ context, owner, repo });

      if (content) {
        return content;
      }
    } catch (e) {
      console.log('Error', e);
    }
    return null;
  }

  // Function to initially check auth and sync tokens with GitHub
  async function syncTokensWithGitHub(context): Promise<TokenProps> {
    try {
      const [owner, repo] = context.id.split('/');
      const hasBranches = await fetchBranches({ context, owner, repo });

      if (!hasBranches) {
        return null;
      }

      const content = await pullTokensFromGitHub(context);

      const { string: tokenObj } = getTokenObj();

      if (content) {
        if (!hasSameContent(content, tokenObj)) {
          const userDecision = await askUserIfPull();
          if (userDecision) {
            dispatch.tokenState.setLastSyncedState(JSON.stringify(content.values, null, 2));
            dispatch.tokenState.setTokenData(content);
            notifyToUI('Pulled tokens from GitHub');
            return content;
          }
          return { values: tokenObj };
        }
        return content;
      }
      return await pushTokensToGitHub(context);
    } catch (e) {
      notifyToUI('Error syncing with GitHub, check credentials');
      console.log('Error', e);
    }
  }

  async function addNewGitHubCredentials(context): Promise<TokenProps> {
    let { raw: rawTokenObj } = getTokenObj();

    const data = await syncTokensWithGitHub(context);

    if (data) {
      postToFigma({
        type: MessageToPluginTypes.CREDENTIALS,
        ...context,
      });
      if (data?.values) {
        dispatch.tokenState.setLastSyncedState(JSON.stringify(data.values, null, 2));
        dispatch.tokenState.setTokenData(data);
        rawTokenObj = data.values;
      } else {
        notifyToUI('No tokens stored on remote');
      }
    } else {
      return null;
    }

    return {
      values: rawTokenObj,
    };
  }
  return {
    addNewGitHubCredentials,
    syncTokensWithGitHub,
    pullTokensFromGitHub,
    pushTokensToGitHub,
  };
}
