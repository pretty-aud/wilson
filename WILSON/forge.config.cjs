const path = require('path');
const fs = require('fs');

const iconPath = path.join(__dirname, 'public', 'logo.ico');
const hasIcon = fs.existsSync(iconPath);

module.exports = {
  packagerConfig: {
    name: 'WILSON',
    icon: hasIcon ? path.join(__dirname, 'public', 'logo') : undefined,
    prune: true,
    ignore: [
      /^\/src$/,
      /^\/public$/,
      /\.md$/,
      /^\/\.git/,
      /^\/vite\.config\.js$/,
      /^\/index\.html$/,
    ],
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'WILSON',
        setupIcon: hasIcon ? iconPath : undefined,
      },
    },
  ],
};
