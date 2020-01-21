/*
 * (C) Copyright HCL Technologies Ltd. 2018, 2020
 * (C) Copyright IBM Corp. 2012, 2016 All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* https://github.com/chuckdumont/webpack-copyfiles-plugin */

const hashFiles = require('hash-files');
const fs = require('fs-extra');
const path = require('path');
const async = require('async');
const globby = require('globby');
const ConstDependency = require('webpack/lib/dependencies/ConstDependency');
const BasicEvaluatedExpression = require('webpack/lib/BasicEvaluatedExpression');
const {tap, callSyncBail} = require('webpack-plugin-compat').for('webpack-copyfiles-plugin');

/*eslint no-shadow: [2, { "allow": ["callback", "err"] }]*/
module.exports = class CopyFilesPlugin {
	constructor(options) {
		this.byVarName = {};
		this.optionsArray = Array.isArray(options) ? options : [options];
	}

	/**
	 * Remove the cleanDirs and targetRoot directories
	 *
	 * @param {object} options - the options object.
	 * @param {function} callback - the async callback
	 */
	cleanDirs(options, callback) {
		async.each((options.cleanDirs || []).concat(options.targetRoot), (dir, callback) => {
			fs.remove(dir, err => {
				if (err) {
					console.error(err);
				}
				callback(err);
			});
		}, err => callback(err));
	}

	/**
	 * Copies the files specified by options
	 *
	 * @param {object} options - the options object
	 * @param {function} callback - the async callback function
	 */
	copyFiles(options, callback) {
		let sourceRootArray = options.sourceRoot;
		let filesArray = options.files;
		if (!Array.isArray(sourceRootArray)) {
			sourceRootArray = [sourceRootArray];
			filesArray = [filesArray];
		} else if (sourceRootArray.length !== filesArray.length) {
			return callback(new Error("Invalid number of array elements"));
		}
		async.eachOf(sourceRootArray, (sourceRoot, i, callback) => {
			// Copy the files
			console.log(`Copying files from ${sourceRoot} to ${options.targetRoot}`);
			const files = [].concat(filesArray[i]);
			// For backwards compatibility, if an entry ends with '/', change to '/**/*'
			files.forEach((file, j) => {
				if (file.endsWith('/')) {
					files[j] = file + '**/*';
				}
			});
			var numCopied = 0;
			globby(files, {onlyFiles:true, absolute:true, cwd:sourceRoot}).then(paths => {
				async.each(paths, (source, callback) => {
					const relPath = path.relative(sourceRoot, source);
					const target = path.resolve(options.targetRoot, relPath);
					numCopied++;
					fs.copy(source, target, err => {
						if (err) {
							console.error(err);
						}
						callback(err);
					});
				}, err => callback(err));
			}).then(() => {
				console.log(`Copied ${numCopied} files from ${sourceRoot} to ${options.targetRoot}`);
			}).catch(err => callback(err));
		}, err => callback(err));
	}

	/**
	 * Renames the target directory to a hash of the directory's contents and
	 * saves the hash for use by webpack variable substitution.
	 *
	 * @param {object} options - the options array
	 * @param {function} the async callback
	 */
	postProcessDir(options, callback) {
		if (!options.renameTargetDir && !options.filesVarName) {
			return callback();
		}
		globby('**/*', {onlyFiles:true, absolute:true, cwd:options.targetRoot}).then(files => {
			if (options.filesVarName) {
				this.byVarName[options.filesVarName] = [];
				files.forEach(file => {
					const relPath = path.relative(options.targetRoot, file);
					this.byVarName[options.filesVarName].push(relPath.replace(/\\/g, '/'));
				});
			}
			if (!options.renameTargetDir) {
				return callback();
			}
			// Need to rename the target directory.
			hashFiles({
				algorithm: 'sha256',
				files: files,
				noGlob: true
			}, (err, hash) => {
				if (err) {
					return callback(err);
				}
				options.filesHash = Buffer.from(hash, 'hex').toString('base64').replace(/[/+=]/g, c => {
					switch (c) {
						case '/': return '_';
						case '+': return '-';
						case '=': return '';
					}
					return c;
				});
				console.log(`Hash for ${files.length} files in ${options.targetRoot} = ${options.filesHash}`);

				// rename the target directory using the hash
				let newPath = path.resolve(options.targetRoot, '..', options.filesHash);
				fs.remove(newPath, err => {
					if (err) {
						return callback(err);
					}
					fs.rename(path.resolve(options.targetRoot), path.resolve(newPath), err => {
						if (!err) {
							console.log(`Renamed ${options.targetRoot} to ${newPath}`);
						};
						callback(err);
					});
				});
			});
    }).catch(callback);
	}

	/**
	 * The webpack entry point.  Called by the "compiler" event
	 *
	 * @param {object} compiler - Webpack compiler object
	 */
	apply(compiler) {
		tap(compiler, [[['run', 'watch-run'], (compilation__, callback) => {
			if (!this.promise) {
				// First thread here gets to do the copy.
				this.promise = new Promise((resolve, reject) => {
					async.series([
						// First, remove any directories to be cleaned
						callback => {
							async.each(this.optionsArray, (options, callback) => {
								this.cleanDirs(options, callback);
							}, err => callback(err));
						},
						// Next, copy the files and rename the target directories as needed
						callback => {
							async.series([
								callback => {
									async.each(this.optionsArray, (options, callback) => {
										// Copy the files
										this.copyFiles(options, callback);
									}, err => callback(err));
								},
								callback => {
									async.each(this.optionsArray, (options, callback) => {
										// Copy the files
										this.postProcessDir(options, callback);
									}, err => callback(err));
								}
							], err => callback(err));
						}
					], err => {
						if (err) {
							console.error(err);
							reject(err);
						} else {
							resolve();
						}
					});
				});
			}
			// All threads block until the files have been copied.
			this.promise.then(() => callback(), err => callback(err));
		}]]);

		this.optionsArray.forEach(options => {
			if (options.renameTargetDir && options.dirHashVarName || options.filesVarName) {
				tap(compiler, 'compilation', (compilaton__, data) => {
					tap(data.normalModuleFactory, 'parser', parser => {
						if (options.dirHashVarName) {
							tap(parser, 'expression ' + options.dirHashVarName , expr => {
								// change dirHashVarName expressions in the source to the hash value as a string.
								const hash = callSyncBail(parser, `evaluate Identifier ${options.dirHashVarName}`, expr).string;
								const dep = new ConstDependency('"' + hash + '\"', expr.range);
								dep.loc = expr.loc;
								parser.state.current.addDependency(dep);
								return true;
							});

							tap(parser, `evaluate typeof ${options.dirHashVarName}`, expr => {
								// implement typeof operator for the expression
								var result = new BasicEvaluatedExpression().setString('string');
								if (expr) {
									result.setRange(expr.range);
								}
								return result;
							});

							tap(parser, `evaluate Identifier ${options.dirHashVarName}`, expr => {
								var result = new BasicEvaluatedExpression().setString(options.filesHash);
								if (expr) {
									result.setRange(expr.range);
								}
								return result;
							});
						}

						if (options.filesVarName) {
							tap(parser, 'expression ' + options.filesVarName , expr => {
								// change filesVarName expressions in the source to the files array.
								const files = callSyncBail(parser, `evaluate Identifier ${options.filesVarName}`, expr).array;
								const dep = new ConstDependency(JSON.stringify(files), expr.range);
								dep.loc = expr.loc;
								parser.state.current.addDependency(dep);
								return true;
							});

							tap(parser, `evaluate typeof ${options.filesVarName}`, expr => {
								// implement typeof operator for the expression
								var result = new BasicEvaluatedExpression().setString('array');
								if (expr) {
									result.setRange(expr.range);
								}
								return result;
							});

							tap(parser, `evaluate Identifier ${options.filesVarName}`, expr => {
								var result = new BasicEvaluatedExpression().setArray(this.byVarName[options.filesVarName]);
								if (expr) {
									result.setRange(expr.range);
								}
								return result;
							});
						}
					});
				});
			}
		});
	}
};
