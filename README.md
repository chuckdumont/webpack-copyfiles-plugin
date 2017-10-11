# webpack-copyfiles-plugin

Copies files from the source directory to the target directory.  Can optionally clean directories and rename the target directory using a hash of the contents of the directory after copying, and then replace occurrences of a replacement string in the source with the hash value.  

The plugin is multi-compiler aware, so if the same instance of the plugin is used for multiple compiler runs, then the files are copied only once, and cleaned directories are deleted only once.

## Install

```bash
npm i -D webpack-copyfiles-plugin
```
## Usage

```javascript
// webpack.config.js
var CopyFilesPlugin = require('webpack-copyfiles-plugin');

module.exports = {
  // ... snip ...
  plugins: [
		new CopyFilesPlugin({
		  sourceRoot: path.join(__dirname, "sources"),
		  targetRoot: path.join(__dirname, "dist", "temp"),
		  files: require('./NonModuleFiles'),
		  renameTargetDir: true,
		  dirHashVarName: '__dirhash__',
		  cleanDirs: [path.join(__dirname, "dist")]
		});
  ],
  // ... snip ...
}
```
## Options

#### sourceRoot

The root directory containing the source files to copy.  This option is required.  It can be a string or an array.  If it is an array, then the `files` option must be an array consisting of the same number of elements.

#### targetRoot

The target directory to copy the source files to.  This option is required.

#### files

Array of file/directory names to copy.  Directories are specified with a trailing `/`.  Relative path names are relative to `sourceRoot`.  If `sourceRoot` is an array, then this option must be an array of arrays containing the same number of top level elements as `sourceRoot`.

#### renameTargetDir

If true, the last path component of `targetRoot` will be renamed using a hash of the directory's contents.

#### dirHashVarName

If specified and `renameTargetDir` is true, then occurrences of the specified string in the source modules processed by webpack will be replaced with the hash of the directory contents as a string.

#### cleanDirs

Specifies an array of directory names to remove prior to copying the files.  `targetRoot` is always cleaned and therefore does not need to be specified here.
