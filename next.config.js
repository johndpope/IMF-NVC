// next.config.js
const CopyWebpackPlugin = require('copy-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const path = require('path');

module.exports = {
  webpack: (config, { isServer }) => {
    // Adjust output settings
    config.output.library = {
      type: 'module',
    };

    // Add CopyWebpackPlugin to copy .wasm files to the output directory
    config.plugins.push(
      new CopyWebpackPlugin({
        patterns: [
          {
            from: path.resolve(__dirname, 'node_modules/onnxruntime-web/dist/*.wasm'),
            to: path.resolve(__dirname, 'public/[name][ext]'),
          },
        ],
      })
    );

    // Add TerserPlugin to minimize the output
    if (!isServer) {
      config.optimization.minimize = true;
      config.optimization.minimizer = [
        new TerserPlugin({
          test: /\.min\.js$/,
          extractComments: false,
        }),
      ];
    }

    // Enable Webpack experiments if needed
    config.experiments = {
      outputModule: true,
    };

    // Return the modified config
    return config;
  },
};
