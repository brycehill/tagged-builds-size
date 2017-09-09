#!/usr/bin/env node

const chalk = require('chalk')
const each = require('async/eachSeries')
const exec = require('child_process').exec
const fs = require('fs')
const git = require('simple-git')()
const gzipSize = require('gzip-size')
const path = require('path')
const prettyBytes = require('pretty-bytes')
const process = require('process')
const rimraf = require('rimraf')
const util = require('util')
const webpack = require('webpack')

const data = {}
const CWD = process.cwd()
// TODO: Get one tag by week or something?
git.tags((err, { all }) => {
  if (err) return console.error(err)
  const tags = all.reverse().slice(0, 3)
  console.log(`Found ${chalk.cyan(all.length)} tags: ${tags.join(', ')}`)
  each(
    tags,
    (tag, cb) => {
      console.log(chalk.yellow('Tag:', tag))
      git.checkout(tag, (err, x) => {
        if (err) return console.error(chalk.red(err))

        data[tag] = data[tag] || []
        console.log('Removing old dependencies')
        rimraf(`${CWD}/node_modules`, {}, err => {
          if (err) return console.error(err)
          console.log('Installing new dependencies')
          exec(
            'yarn --no-progress --production=false',
            { cwd: CWD },
            (err, stdout, stderr) => {
              if (err) return console.error(chalk.red(err, stderr))
              process.env.NODE_ENV = 'production'
              // TODO: Get from args
              const conf = require(`${CWD}/config/webpack.config.js`)
              const config =
                typeof conf === 'function' ? conf({ app: 'publisher' }) : conf
              console.log('Building with webpack')
              // TODO: Create module that builds webpack and spits out the entry point
              // bundle gzipped sizes. For use in a GH bot???
              webpack(config, (err, stats) => {
                if (err) return console.error(err)
                const json = stats.toJson({
                  assets: true,
                  cached: false,
                  cachedAssets: false,
                  chunks: false,
                  chunkModules: false,
                  publicPath: true,
                  modules: false
                })

                if (stats.hasErrors()) {
                  console.error(chalk.red(json.errors))
                  return cb()
                }
                if (stats.hasWarnings())
                  console.warn(chalk.yellow(json.warnings))

                console.log(chalk.green('Bundle built'))
                json.assets.forEach(asset => {
                  Object.keys(json.entrypoints).forEach(name => {
                    const ep = json.entrypoints[name]
                    const re = /\.(js|css)$/

                    if (ep.assets.includes(asset.name) && re.test(asset.name)) {
                      console.log(`${asset.name} - ${asset.size}`)
                      const p = path.join(
                        CWD,
                        // Get public???
                        'public',
                        json.publicPath,
                        asset.name
                      )
                      const file = fs.readFileSync(p, 'utf8')
                      data[tag].push({
                        name: asset.name,
                        size: prettyBytes(gzipSize.sync(file))
                      })
                    }
                  })
                })
                cb()
              })
            }
          )
        })
      })
    },
    () => {
      console.log(chalk.green('All Done!'))
      console.log(JSON.stringify(data, null, 2))
    }
  )
})
