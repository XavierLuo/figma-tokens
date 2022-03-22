import { getTree } from './getTree';

describe('getTree', () => {
  it('returns a tree', () => {
    const input = ['global', 'theme/type', 'theme/colors/blue', 'theme/colors/red', 'semantic/typography/default', 'semantic/typography/headings/large/default'];
    const output = [
      {
        path: 'global',
        key: 'global/set',
        parent: '',
        type: 'set',
        level: 0,
        label: 'global',
      },
      {
        path: 'semantic/typography',
        key: 'semantic/typography/folder',
        parent: 'semantic',
        type: 'folder',
        level: 0,
        label: 'semantic/typography',
      },
      {
        path: 'semantic/typography/default',
        key: 'semantic/typography/default/set',
        parent: 'semantic',
        type: 'folder',
        level: 1,
        label: 'default',
      },
      {
        path: 'semantic/typography/headings/large',
        key: 'semantic/typography/headings/large/folder',
        parent: 'semantic',
        type: 'folder',
        level: 1,
        label: 'headings/large',
      },
      {
        path: 'semantic/typography/headings/large/default',
        key: 'semantic/typography/headings/large/default/set',
        parent: 'semantic/typography/headings/large',
        type: 'set',
        level: 2,
        label: 'default',
      },
      {
        path: 'theme',
        key: 'theme/folder',
        parent: '',
        type: 'folder',
        level: 0,
        label: 'theme',
      },
      {
        path: 'theme/colors',
        key: 'theme/colors/folder',
        parent: 'theme',
        type: 'folder',
        level: 1,
        label: 'colors',
      },
      {
        path: 'theme/colors/blue',
        key: 'theme/colors/blue/set',
        parent: 'theme/colors',
        type: 'set',
        level: 2,
        label: 'blue',
      },
      {
        path: 'theme/colors/red',
        key: 'theme/colors/red/set',
        parent: 'theme/colors',
        type: 'set',
        level: 2,
        label: 'red',
      },
      {
        path: 'theme/type',
        key: 'theme/type/set',
        parent: 'theme',
        type: 'set',
        level: 1,
        label: 'type',
      },
    ];
    expect(getTree(input)).toEqual(output);
  });
});
