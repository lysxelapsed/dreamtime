import { merge, attempt, isNil } from 'lodash'
import path from 'path'
import slash from 'slash'
import EventEmitter from 'eventemitter3'
import { Consola } from './consola'
import { getMetadata } from '~/workers/fs'

const consola = Consola.create('file')
const { fs } = $provider
const { dialog, shell } = $provider.api
const { getPath } = $provider.paths

/**
 * Represents a local file.
 */
export class File extends EventEmitter {
  /**
   * File name without extension.
   * @type {string}
   */
  name

  /**
   * Full file name.
   * @type {string}
   */
  fullname

  /**
   * Full file path.
   * @type {string}
   */
  path

  /**
   * File extension.
   * @type {string}
   */
  extension

  /**
   * Directory path.
   * @type {string}
   */
  directory

  /**
   * @type {string}
   *
   */
  dataURL

  /**
   * @type {string}
   */
  mimetype

  /**
   * @type {Number}
   */
  size = -1

  /**
   * @type {boolean}
   */
  exists = false

  /**
   * Hash MD5.
   * @type {string}
  */
  md5

  birthtime

  /**
   *
   *
   */
  options = {
    deleteIfExists: false,
    asyncLoad: false,
    storeDataURL: false,
    watch: true,
  }

  /**
   *
   * @type {string}
   * @readonly
   */
  get url() {
    return this.dataURL || this.path
  }

  /**
   * Open a local file.
   * @param {string} filepath
   */
  static fromPath(filepath, options = {}) {
    const file = new this(filepath, options)
    return file.load()
  }

  /**
   * Open a file from the Internet.
   * @param {string} url
   */
  static async fromUrl(url, options = {}) {
    consola.debug(`Downloading: ${url}`)

    // Download the file in the temporary folder.
    const filepath = await fs.downloadAsync(url, {
      directory: getPath('temp'),
    })

    const file = new this(filepath, options)
    await file.load()

    return file
  }

  /**
   * Open a file using the metadata.
   * @param {Object} metadata
   */
  static fromMetadata(metadata, options = {}) {
    const file = new this(null, options)

    file.setMetadata(metadata)
    file.setup()

    return file
  }

  /**
   *
   * @param {string} filepath
   * @param {boolean} deleteIfExists
   */
  constructor(filepath, options = {}) {
    super()

    this.options = merge(this.options, options)

    this.path = filepath

    this.setup()
  }

  setup() {
    if (!this.path) {
      return this
    }

    if (this.options.deleteIfExists) {
      attempt(() => {
        fs.unlinkSync(this.path)
        consola.debug(`Deleted: ${this.path}`)
      })
    }

    if (this.options.asyncLoad) {
      this.load(this.path)
    }

    if (this.options.watch) {
      fs.chokidar.watch(this.path, {
        disableGlobbing: true,
        awaitWriteFinish: true,
      }).on('all', () => {
        this.load()
      })

      // consola.debug(`Watching: ${this.path}`)
    }

    return this
  }

  /**
   * @param {string} [filepath]
   * @deprecated
   */
  open(filepath) {
    return this.load(filepath)
  }

  /**
   *
   *
   * @param {string} filepath
   */
  async load(filepath) {
    if (!filepath) {
      filepath = this.path
    }

    this.emit('loading')

    const metadata = await getMetadata(filepath)

    this.setMetadata(metadata)

    this.emit('loaded')

    return this
  }

  /**
   * @param {Object} metadata
   */
  setMetadata(metadata) {
    this.name = metadata.name
    this.extension = metadata.ext.substring(1).toLowerCase()
    this.fullname = `${this.name}.${this.extension}`
    this.directory = slash(metadata.dir)
    this.realpath = path.join(this.directory, this.fullname)
    this.path = slash(this.realpath)
    this.mimetype = metadata.mimetype
    this.size = metadata.size
    this.exists = metadata.exists
    this.md5 = metadata.md5
    this.birthtime = metadata.birthtime

    if (this.options.storeDataURL) {
      this.dataURL = metadata.dataURL
    }

    if (this.exists) {
      // consola.debug(`Loaded: ${this.path} (${this.md5})`)
    } else {
      // consola.debug(`Loaded: ${this.path} (does not exist)`)
    }

    return this
  }

  getPath(ext) {
    return slash(path.join(this.directory, `${this.name}.${ext}`))
  }

  isSamePath(filepath) {
    return slash(filepath) === this.path
  }

  validateAsPhoto() {
    const { exists, mimetype, path: filePath } = this

    if (!exists) {
      throw new Warning('Invalid photo.', `"${filePath}" does not exists.`)
    }

    if (mimetype !== 'image/jpeg' && mimetype !== 'image/png' && mimetype !== 'image/gif') {
      throw new Warning('Invalid photo.', `<code>${filePath}</code> is not a valid photo. Only jpeg, png or gif.`)
    }
  }

  validateAs(mtype) {
    const { exists, mimetype, path: filePath } = this

    if (!exists) {
      throw new Warning('Invalid file.', `"${filePath}" does not exists.`)
    }

    if (mimetype !== mtype) {
      throw new Warning('Invalid file.', `<code>${filePath}</code> is not a valid file. Only ${mtype}.`)
    }
  }

  /**
   * Delete the file.
   */
  unlink() {
    if (!this.exists) {
      return this
    }

    fs.unlinkSync(this.path)

    this.emit('deleted')

    consola.debug(`Deleted: ${this.fullname}`)

    return this
  }

  /**
   * Write the dataURL as file content.
   * @param {string} data
   */
  writeDataURL(data) {
    fs.writeDataURL(this.path, data)

    this.emit('writed')

    return this
  }

  /**
   *
   *
   * @param {File} file
   */
  writeFile(file) {
    fs.copySync(file.path, this.path)

    this.emit('writed')

    return this
  }

  write(data) {
    fs.writeFileSync(this.path, data)

    this.emit('writed')

    return this
  }

  /**
   * @param {string} destination
   */
  async copy(destination) {
    if (!this.exists) {
      return this
    }

    fs.copySync(this.path, destination)

    this.emit('copied')

    consola.debug(`Copied: ${this.path} -> ${destination}`)

    return this
  }

  /**
   *
   */
  save(defaultPath) {
    if (!fs.existsSync(this.path)) {
      throw new Warning(
        'The photo no longer exists.',
        'Could not save the photo because it has been deleted, this could be caused due to cleaning or antivirus programs.',
      )
    }

    const savePath = dialog.showSaveDialogSync({
      defaultPath,
      filters: [
        { name: 'PNG', extensions: ['png'] },
        { name: 'JPG', extensions: ['jpg'] },
        { name: 'GIF', extensions: ['gif'] },
      ],
    })

    if (isNil(savePath)) {
      return this
    }

    this.copy(savePath)

    return this
  }

  openItem() {
    if (!fs.existsSync(this.path)) {
      throw new Warning(
        'The photo no longer exists.',
        'Could not open the photo because it has been deleted, this could be caused due to cleaning or antivirus programs.',
      )
    }

    shell.openPath(this.path)
  }
}
