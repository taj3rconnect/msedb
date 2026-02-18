/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const { DefinePlugin } = require("webpack");

module.exports = async (_env, options) => {
  const isDev = options.mode === "development";

  let devServerOptions = {};
  if (isDev) {
    const devCerts = require("office-addin-dev-certs");
    const httpsOptions = await devCerts.getHttpsServerOptions();
    devServerOptions = {
      server: {
        type: "https",
        options: httpsOptions,
      },
      port: 3000,
      hot: true,
      allowedHosts: "all",
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
    };
  }

  return {
    entry: {
      taskpane: "./src/taskpane/taskpane.tsx",
      commands: "./src/commands/commands.ts",
    },
    output: {
      path: path.resolve(__dirname, "dist"),
      filename: "[name].js",
      clean: true,
    },
    resolve: {
      extensions: [".ts", ".tsx", ".js", ".jsx"],
      extensionAlias: {
        ".js": [".ts", ".tsx", ".js"],
      },
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: "ts-loader",
          exclude: /node_modules/,
        },
        {
          test: /\.css$/,
          use: [
            "style-loader",
            "css-loader",
            {
              loader: "postcss-loader",
              options: {
                postcssOptions: {
                  plugins: ["@tailwindcss/postcss"],
                },
              },
            },
          ],
        },
      ],
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: "./src/taskpane/taskpane.html",
        filename: "taskpane.html",
        chunks: ["taskpane"],
      }),
      new HtmlWebpackPlugin({
        template: "./src/commands/commands.html",
        filename: "commands.html",
        chunks: ["commands"],
      }),
      new CopyWebpackPlugin({
        patterns: [
          {
            from: "assets",
            to: "assets",
          },
        ],
      }),
      new DefinePlugin({
        BACKEND_URL: JSON.stringify(
          process.env.MSEDB_BACKEND_URL || "http://172.16.219.222:8010"
        ),
        AZURE_AD_CLIENT_ID: JSON.stringify(
          process.env.AZURE_AD_CLIENT_ID || "YOUR_CLIENT_ID"
        ),
        AZURE_AD_TENANT_ID: JSON.stringify(
          process.env.AZURE_AD_TENANT_ID || "YOUR_TENANT_ID"
        ),
        ADDIN_DOMAIN: JSON.stringify(
          process.env.ADDIN_DOMAIN || "localhost:3000"
        ),
      }),
    ],
    devServer: devServerOptions,
  };
};
