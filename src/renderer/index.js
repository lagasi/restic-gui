/*global __static*/

const { exec } = require("child_process")
const { dialog, shell } = require("electron").remote
const fs = require("fs")
const path = require("path")
const { format } = require("date-fns")
const Store = require("../common/store")
const util = require("../common/util")

// This file is required by the index.html file and will
// be executed in the renderer process for that window.
// All of the Node.js APIs are available in this process.

const opts = {
  maxBuffer: 10000 * 1024,
}
const MAX = Infinity
const DATETIME_FORMAT = "yyyy-MM-dd hh:mm:ss"

const store = new Store({
  name: "restic",
})

var stack = []
var cache = {}
var curPath = ""

const styles = document.createElement("style")
fs.readFile(path.join(__static, "bulma.min.css"), (err, bulma) => {
  if (err) console.error(err)

  fs.readFile(path.join(__static, "main.css"), (err, main) => {
    if (err) console.error(err)

    styles.innerText = bulma + main
    document.head.appendChild(styles)
  })
})

var loadingClassList
var repo = store.get("repo")
if (repo == null) repo = ""
var password = ""

fs.readFile(path.join(__static, "index.html"), (err, data) => {
  if (err) console.error(err)

  document.getElementById("app").innerHTML = data
  loadingClassList = document.getElementById("Loading").classList

  var password = ""
  document.configForm.repo.value = repo

  document.getElementById("loadBtn").addEventListener("click", function (e) {
    repo =  document.configForm.repo.value
    password =  document.configForm.password.value
    store.set("repo", repo)

    fs.access(repo, fs.constants.R_OK, function (err) {
      if (err) dialog.showErrorBox("Error", "Directory does not exist.")

      if (password.length > 0)
        getSnapshots(repo, password)
      else {
        dialog.showErrorBox("Error", "Password required.")
      }
    })
  })
})

function getSnapshots(repo, password) {

  process.env.RESTIC_PASSWORD = password

  loadingClassList.remove("is-invisible")

  exec(`restic -r ${repo} snapshots --json`, opts, (err, stdout, stderr) => {
  //exec(`restic -r ${repo} --password-file ${passwordFile} snapshots --json`, (err, result) => {
    loadingClassList.add("is-invisible")

    if (err) {
      dialog.showErrorBox("Error", err.message)
      console.log(err)
    } else if (stderr) {
      dialog.showErrorBox("Error", stderr)
    } else {
      //console.log(stdout)
      let data = JSON.parse(stdout)
      let table = ""
      data = data.reverse()

      let end = data.length > MAX ? MAX : data.length

      for (let i = 0; i < end; i++) {
        let x = data[i]
        let time = new Date(x.time)
        let timeString = format(time, DATETIME_FORMAT)
        //console.log(x.tree)
        table += `<tr id="snap-${i}"><td><a class="snapshot" tree="${x.tree}" name="${x.short_id}">${x.short_id}</a></td><td>${timeString}</td><td>${x.paths.join(",")}</td></tr>`
      }

      document.getElementById("snapshots").innerHTML = table
    }
    let links = document.getElementsByClassName("snapshot")
    for (let link of links) {
      link.addEventListener("click", function (e) {
        //console.log('clicked', e)

        var snapshotsTable = document.getElementById("snapshotsTable")
        for(let row of snapshotsTable.rows) {
          row.classList.remove("is-selected")
        }

        let tree = e.target.getAttribute("tree")
        let name = e.target.getAttribute("name")
        //console.log(e)
        e.target.parentElement.parentElement.classList.add("is-selected")
        stack.length = 0
        loadTree(tree, name)

      })
    }
  })
}

function parse(nodes) {
  let table = ""
  if (stack.length > 1) {
    table = "<tr><td><a id=\"traverseUp\">... Up a directory</a></td><td></td><td></td><td></td></tr>"
  }

  for (let x of nodes) {
    let time = new Date(x.mtime)

    let timeString = format(time, DATETIME_FORMAT)

    if (x.type === "dir")
      table += `<tr>
                  <td><a class="dir" tree="${x.subtree}" name="${x.name}">${x.name}</a></td>
                  <td>${timeString}</td>
                  <td></td>
                  <td><button class="button file is-small" name="${x.name}">Restore</button></td>
                </tr>`



    else if (x.size)
      table += `<tr>
                  <td>${x.name}</td>
                  <td>${timeString}</td><td>${util.filesize(x.size)}</td>
                  <td><button class="button file is-small" content="${x.content}" name="${x.name}">Restore</button></td>
                </tr>`
  }

  document.getElementById("files").innerHTML = table

  let dirs = document.getElementsByClassName("dir")
  for (let link of dirs) {
    link.addEventListener("click", function (e) {
      //console.log('clicked', e)
      loadTree(e.target.getAttribute("tree"), e.target.getAttribute("name"))
    })
  }
  let files = document.getElementsByClassName("file")
  for (let link of files) {
    link.addEventListener("click", function (e) {
      //console.log('clicked', e)
      //loadContent(e.target.getAttribute("content"), e.target.getAttribute("name"))
      restore(e.target.getAttribute("name"))
    })
  }
  if (stack.length > 1) {
    document.getElementById("traverseUp").addEventListener("click", function(e) {
      stack.pop()
      parse(cache[stack[stack.length-1].tree])
      updateBreadCrumbs()
    })
  }
}

function loadTree(tree, name) {

  stack.push({name: name, tree: tree})
  updateBreadCrumbs()

  if (cache[tree]) {
    parse(cache[tree])
    return
  }

  loadingClassList.remove("is-invisible")
  process.env.RESTIC_PASSWORD = password

  console.log("tree", tree)

  exec(`restic -r ${repo} cat blob ${tree} --json`, opts, (err, stdout, stderr) => {
  //exec(`restic -r ${repo} --password-file ${passwordFile} snapshots --json`, (err, result) => {
    loadingClassList.add("is-invisible")

    if (err) {
      dialog.showErrorBox("Error", err.message)
    } else if (stderr) {
      dialog.showErrorBox("Error", stderr)
    } else {
      //console.log(stdout)
      let data = JSON.parse(stdout)

      data.nodes.sort((a, b) => {
        if (a.type === b.type) {
          if (a.name > b.name) return 1
          if (a.name < b.name) return -1
          return 0
        }
        return a.type > b.type ? 1 : -1
      })
      cache[tree] = data.nodes
      parse(data.nodes)
    }
  })
}

function loadContent(content, filename) {
  console.log(content)

  loadingClassList.remove("is-invisible")

  let path = dialog.showSaveDialog({
    defaultPath: filename,
  })
  if (path) {

    exec(`restic -r ${repo} cat blob ${content}`, { maxBuffer: 10*1024, encoding: "binary" }, (err, stdout, stderr) => {
    //exec(`restic -r ${repo} --password-file ${passwordFile} snapshots --json`, (err, result) => {
      loadingClassList.add("is-invisible")

      if (err) {
        console.log(err)
      } else if (stderr) {
        console.log(stderr)
      } else {
        //console.log(stdout)
        fs.writeFile(path, stdout, {encoding: "binary"}, function(err) {
          if (err) console.log(err)
        })
      }
    })
  }
}

function restore(name) {
  let restoreItem = curPath + "/" + name

  let path = dialog.showOpenDialog({
    properties: ["openDirectory"],
  })[0]
  if (path) {
    loadingClassList.remove("is-invisible")

    let cmd = `restic -r "${repo}" restore ${stack[0].name} --target "${path}" --include "${restoreItem}"`
    console.log(cmd)
    exec(cmd, (err, stdout, stderr) => {
      loadingClassList.add("is-invisible")

      if (err) {
        dialog.showErrorBox("Error", err.message)
      } else if (stderr) {
        dialog.showErrorBox("Error", stderr)
      } else {
        shell.openItem(path)
      }
    })
  }
}

function updateBreadCrumbs() {

  let breadcrumbs = document.getElementById("breadcrumbs")

  let path = ""
  for (let item of stack) {
    path += `/${item.name}`
  }
  curPath = path.split("/").slice(2).join("/")
  breadcrumbs.innerHTML = path
}
