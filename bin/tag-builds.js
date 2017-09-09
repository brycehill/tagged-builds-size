#!/usr/bin/env node

const exec = require('child_process').exec
const each = require('async/eachSeries')
const webpack = require('webpack')
const util = require('util')

// Make this configurable
const process = require('process')
// TODO: set this in the config
// TODO: Pass in PWD?
const git = require('simple-git')()

const data = {}

git.tags((err, { all }) => {
  if (err) return console.error(err)
  all.reverse()
  each(all.slice(0, 1), (tag, cb) => {
    git.checkout(tag, (err, x) => {
      if (err) return console.error(err)

      data[tag] = data[tag] || {}
      exec('rm -rf ./node_modules && yarn', (err, stdout, stderr) => {
        if (err) return console.error(err, stderr)
        process.env.NODE_ENV = 'production'
        const config = require('../../clearvoice/config/webpack.config.js')
        webpack(config, (err, stats) => {
          if (err) return console.error(err)
          console.log('Tag:', tag)
          const json = stats.toJson({
            assets: true,
            chunks: true,
            chunkModules: true,
            modules: true,
            source: false
          })
          json.assets.forEach(asset => {
            Object.keys(json.entrypoints).forEach(name => {
              const ep = json.entrypoints[name]
              const re = /\.(js|css)$/
              if (ep.assets.includes(asset.name) && re.test(asset.name)) {
                data[tag].name = asset.name
                data[tag].size= asset.size
                console.log(`${asset.name} - ${asset.size}`)
              }
            })
          })
          cb()
        })
      })
    })
  }, () => {
    console.log(JSON.stringify(data, null, 2))
  })
})
