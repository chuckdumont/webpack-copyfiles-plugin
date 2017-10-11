/*
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
const fs  = require('fs-extra');
const path = require('path');
const async = require('async');
const ConstDependency = require("webpack/lib/dependencies/ConstDependency");
const BasicEvaluatedExpression = require("webpack/lib/BasicEvaluatedExpression");

/*eslint no-shadow: [2, { "allow": ["callback", "err"] }]*/
module.exports = class CopyFilesPlugin {
  constructor(options) {
    this.options = options;
  }
  apply(compiler) {

    compiler.plugin(["run", "watch-run"], (compilation__, callback) => {
      if (!this.promise) {
        // First thread here gets to do the copy.
        this.promise = new Promise((resolve, reject) => {
          async.each((this.options.cleanDirs || []).concat(this.options.targetRoot), (dir, callback) => {
            fs.remove(dir, (err) => {
              if (err) {
                console.error(err);
              }
              callback(err);
            });
          }, (err) => {
            if (err) {
              return reject(err);
            }
            let sourceRootArray = this.options.sourceRoot;
            let filesArray = this.options.files;
            if (!Array.isArray(sourceRootArray)) {
              sourceRootArray = [sourceRootArray];
              filesArray = [filesArray];
            } else if (sourceRootArray.length !== filesArray.length) {
              throw new Error("Invalid number of array elements");
            }
            const filesCopied = [];
            async.parallel([
              (callback) => {
                async.eachOf(sourceRootArray, (sourceRoot, i, cb1) => {
                  // Copy the files
                  console.log(`Copying files from ${sourceRoot} to ${this.options.targetRoot}`);
                  async.each(filesArray[i], (file, cb2) => {
                    filesCopied.push(path.join(sourceRoot, file) + (file.endsWith("/") ? "**" : ""));
                    fs.copy(path.resolve(sourceRoot, file), path.resolve(this.options.targetRoot, file), (err) => {
                      if (err) {
                        console.log(err);
                      }
                      cb2(err);
                    });
                  }, (err) => {
                    cb1(err);
                  });
                }, (err) => {
                  callback(err);
                });
              },
              // calculate a hash for the files
              (callback) => {
                if (!this.options.renameTargetDir) {
                  return callback();
                }
                hashFiles({
                  algorithm: "sha256",
                  files: filesCopied
                }, (err, hash) => {
                  if (err) {
                    console.error(err);
                  }
                  this.filesHash = Buffer.from(hash, "hex").toString('base64').replace(/[/+=]/g, (c) => {
                    switch (c) {
                      case '/': return '_';
                      case '+': return '-';
                      case '=': return '';
                    }
                    return c;
                  });
                  console.log("Hash for copied files = " + this.filesHash);
                  callback(err);
                });
              }
            ], (err) => {
              if (err) {
                return reject(err);
              }
              if (this.options.renameTargetDir) {
                // rename the target directory using the hash
                let newPath = path.resolve(this.options.targetRoot, "..", this.filesHash);
                fs.remove(newPath, (err) => {
                  if (err) {
                    console.error(err);
                    return reject(err);
                  }
                  fs.rename(path.resolve(this.options.targetRoot), path.resolve(newPath), (err) => {
                    if (err) {
                      reject.error(err);
                    } else {
                      console.log("Renamed " + this.options.targetRoot + " to " + newPath);
                      resolve();
                    }
                  });
                });
              } else {
                resolve();
              }
            });
          });
        });
      }
      // All threads block until the files have been copied.
      this.promise.then(() => {
        callback();
      }, (err) => {
        callback(err);
      });
    });

    if (this.options.renameTargetDir && this.options.dirHashVarName) {

      compiler.plugin("compilation", (compilaton__, data) => {
        data.normalModuleFactory.plugin("parser", (parser) => {
          parser.plugin("expression " + this.options.dirHashVarName , (expr) => {
            // change dirHashVarName expressions in the source to the hash value as a string.
            const hash = parser.applyPluginsBailResult("evaluate Identifier " + this.options.dirHashVarName, expr).string;
            const dep = new ConstDependency("\"" + hash + "\"", expr.range);
            dep.loc = expr.loc;
            parser.state.current.addDependency(dep);
            return true;
          });

          parser.plugin("evaluate typeof " + this.options.dirHashVarName, (expr) => {
            // implement typeof operator for the expression
            var result = new BasicEvaluatedExpression().setString("string");
            if (expr) {
              result.setRange(expr.range);
            }
            return result;
          });

          parser.plugin("evaluate Identifier " + this.options.dirHashVarName, (expr) => {
            var result = new BasicEvaluatedExpression().setString(this.filesHash);
            if (expr) {
              result.setRange(expr.range);
            }
            return result;
          });
        });
      });
    }
  }
};
