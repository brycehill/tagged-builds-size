#!/usr/bin/env node

const chalk = require('chalk')
const eachOf = require('async/eachOfSeries')
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

const data = []
const CWD = process.cwd()

git.tags(
  { '--format': '%(taggerdate)|%(refname:short)', '--sort': '-taggerdate' },
  (err, { all }) => {
    if (err) return console.error(err)
    const tags = all.slice(0, 100)
    console.log(`Found ${chalk.cyan(all.length)} tags`)
    eachOf(
      tags,
      (t, i, cb) => {
        const [date, tag] = t.split('|')
        console.log(chalk.yellow('Tag:', tag), `(${i + 1} of ${tags.length})`)
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
                  `./node_modules/.bin/webpack --config ${configPath} -j --env.app=publisher`,
                  { cwd: CWD, maxBuffer: Infinity },
                  (err, stdout, stderr) => {
                    if (err) return console.error(err)
                    const stats = JSON.parse(stdout)
                    console.log(chalk.green('Bundle built'))
                    stats.chunks
                      .filter(chunk => !!chunk.initial)
                      .forEach(chunk => {
                        const re = /\.(js|css)$/
                        const files = chunk.files.filter(f => re.test(f))
                        files.forEach(file => {
                          const p = path.join(
                            CWD,
                            // Get public??? or build into specific folder?
                            'public',
                            stats.publicPath,
                            file
                          )
                          const f = fs.readFileSync(p, 'utf8')
                          const size = prettyBytes(gzipSize.sync(f))
                          console.log(`${file} - ${size}`)
                          data[tag].bundles.push({
                            name: file,
                            size
                          })
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
        const asList = Object.keys(data).reduce((arr, tag) => {
          return [
            ...arr,
            { tag, bundles: data[tag].bundles, date: data[tag].date }
          ]
        }, [])
        const stringified = JSON.stringify(asList, null, 2)
        console.log(chalk.green(stringified))
        fs.writeFileSync('sizes.json', stringified)
      }
    )
  }
)
