const SIZES = [
  " KB",
  " MB",
  " GB",
]
module.exports.filesize = function (bytes) {
  let size = bytes / 1024
  for(let label of SIZES) {
    if (size < 1024) return size.toFixed(2) + label
    size /= 1024
  }
}
