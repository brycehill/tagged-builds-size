#!/usr/bin/env node

const chalk = require('chalk')
const eachOf = require('async/eachOfSeries')
const exec = require('child_process').exec
const fs = require('fs')
const gzipSize = require('gzip-size')
const path = require('path')
const git = require('simple-git')()
const prettyBytes = require('pretty-bytes')
const process = require('process')
const rimraf = require('rimraf')
const util = require('util')
const webpack = require('webpack')

const data = {}
const CWD = process.cwd()
let currentIteration = 0
let end = 100
let skipCount = 0
let retryCount = 0

function main() {
  git.tags(
    { '--format': '%(taggerdate)|%(refname:short)', '--sort': '-taggerdate' },
    (err, { all }) => {
      if (err) return handleError(err)
      const tags = all.slice(currentIteration, end)
      console.log(`Found ${chalk.cyan(all.length)} tags`)
      eachOf(
        tags,
        (t, i, cb) => {
          const [_, tag] = t.split('|')
          currentIteration += i
          console.log(chalk.yellow('Tag:', tag), `(${i + 1} of ${tags.length})`)
          git.checkout(['--merge', tag], (err, x) => {
            if (err) {
              // Reset and try again
              console.log(
                chalk.bold(
                  `There was an error checking out tag ${tag}. Resetting index and trying again`
                )
              )
              git.reset(['--merge'])
              return handleError(err)
            }
            data[tag] = data[tag] || { bundles: [] }
            console.log(chalk.cyan('Removing old dependencies'))
            // rimraf(`${CWD}/node_modules`, {}, err => {
            // if (err) return handleError(err)
            console.log(chalk.cyan('Installing new dependencies'))
            exec(
              'rm yarn.lock; yarn --no-progress --production=false --ignore-engines',
              { cwd: CWD },
              (err, stdout, stderr) => {
                if (err) return handleError(err)
                process.env.NODE_ENV = 'production'
                // TODO: Get from args
                const configPath = `${CWD}/client/config/webpack/webpack.config.js`
                // TODO: Create module that builds webpack and spits out the entry point
                // bundle gzipped sizes. For use in a GH bot???
                const cmd = `./node_modules/.bin/webpack --env.app="writer" --config ${configPath} --display-chunks --json --profile --mode="production"`
                console.log(chalk.cyan('Building with webpack'), cmd)
                exec(
                  cmd,
                  { cwd: CWD, maxBuffer: Infinity },
                  (err, stdout, stderr) => {
                    if (err) return handleError(err)
                    const stats = JSON.parse(stdout)
                    console.log(chalk.green('Bundle built'))
                    stats.children.forEach(child => {
                      const { assets, namedChunkGroups, outputPath } = child
                      assets
                        .filter(
                          asset =>
                            // Filter out source maps
                            !/\.map$/.test(asset.name) &&
                            namedChunkGroups.publisher.assets.includes(
                              asset.name
                            )
                        )
                        .forEach(asset => {
                          const p = path.join(outputPath, asset.name)
                          const f = fs.readFileSync(p, 'utf8')
                          const size = prettyBytes(gzipSize.sync(f))
                          console.log(`${asset.name} - ${size}`)
                          data[tag].bundles.push({
                            name: asset.name,
                            size: asset.size,
                            prettySize: size
                          })
                        })
                      cb()
                    })
                  }
                  // )
                  // }
                )
              }
            )
          })
        },
        err => {
          if (err) handleError(err)
          buildFile()
        }
      )
    }
  )
}

function handleError(err) {
  console.log(chalk.bold.yellow('An error occured!'))
  console.error(chalk.bold.red('ERROR:', err))
  console.log(chalk.green('Retrying...'))
  console.log(chalk.green(''))
  retryCount++
  if (retryCount < 2) {
    // Wait 30 seconds, then try again
    setTimeout(main, 30000)
  } else if (skipCount < 5) {
    console.log(chalk.cyan('Skipping tag and trying again'))
    currentIteration++
    skipCount++
    main()
  }
  // Error, but still build the list with whatver data we have
  if (Object.keys(data).length) buildFile()
}

// TODO: Clean up publicPath afterward
function buildFile() {
  const asList = Object.keys(data).reduce((arr, tag) => {
    return [...arr, { tag, bundles: data[tag].bundles }]
  }, [])
  const stringified = JSON.stringify(asList, null, 2)
  fs.writeFileSync(`sizes-${Date.now()}.json`, stringified)
}

main()
