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
git.tags(
  { '--format': '%(taggerdate)|%(refname:short)', '--sort': '-taggerdate' },
  (err, { all }) => {
    if (err) return console.error(err)
    const tags = all.slice(0, 10)
    console.log(`Found ${chalk.cyan(all.length)} tags`)
    each(
      tags,
      (t, cb) => {
        const [date, tag] = t.split('|')
        console.log(chalk.yellow('Tag:', tag))
        git.checkout(tag, (err, x) => {
          if (err) return console.error(chalk.red(err))
          data[tag] = data[tag] || { date, bundles: [] }
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
                const configPath = `${CWD}/config/webpack.config.js`
                console.log('Building with webpack')
                // TODO: Create module that builds webpack and spits out the entry point
                // bundle gzipped sizes. For use in a GH bot???
                exec(
                  `./node_modules/.bin/webpack --config ${configPath} -j --display-entrypoints --env.app=publisher`,
                  { cwd: CWD, maxBuffer: Infinity },
                  (err, stdout, stderr) => {
                    if (err) return console.error(err)
                    const json = JSON.parse(stdout)
                    console.log(chalk.green('Bundle built'))
                    json.assets.forEach(asset => {
                      Object.keys(json.entrypoints).forEach(name => {
                        const ep = json.entrypoints[name]
                        const re = /\.(js|css)$/

                        if (
                          ep.assets.includes(asset.name) &&
                          re.test(asset.name)
                        ) {
                          const p = path.join(
                            CWD,
                            // Get public??? or build into specific folder?
                            'public',
                            json.publicPath,
                            asset.name
                          )
                          const file = fs.readFileSync(p, 'utf8')
                          const size = prettyBytes(gzipSize.sync(file))
                          console.log(`${asset.name} - ${size}`)
                          data[tag].bundles.push({
                            name: asset.name,
                            size
                          })
                        }
                      })
                    })
                    cb()
                  }
                )
              }
            )
          })
        })
      },
      () => {
        console.log(chalk.green('All Done!'))
        console.log(JSON.stringify(data, null, 2))
        fs.writeFileSync('sizes.json', JSON.stringify(data, null, 2))
      }
    )
  }
)
