// ─────────────────────────────────────────────────────────────
// Webpack config for Focus Assistant popup (React → Chrome Extension)
//
// Output: dist/popup.bundle.js  (referenced by popup/index.html)
// ─────────────────────────────────────────────────────────────

const path                = require("path");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");

module.exports = {
  // Single entry: the React popup
  entry: {
    popup: "./popup/index.js",
  },

  output: {
    path:     path.resolve(__dirname, "dist"),
    filename: "[name].bundle.js",
    clean:    true,   // wipe dist/ on each build
  },

  module: {
    rules: [
      // ── Transpile JSX / modern JS with Babel ──
      {
        test:    /\.(js|jsx)$/,
        exclude: /node_modules/,
        use:     "babel-loader",
      },
      // ── Bundle CSS into the JS output ──
      {
        test: /\.css$/,
        use:  [
          MiniCssExtractPlugin.loader, // extract CSS to separate file
          "css-loader",
        ],
      },
    ],
  },

  plugins: [
    new MiniCssExtractPlugin({
      filename: "[name].bundle.css",
    }),
  ],

  resolve: {
    extensions: [".js", ".jsx"],
  },

  // Source maps for easier debugging in dev
  devtool: "cheap-source-map",
};
