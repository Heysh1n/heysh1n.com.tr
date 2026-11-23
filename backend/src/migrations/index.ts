import * as migration_20261123_220513_add_releases_collection from './20261123_220513_add_releases_collection'

export const migrations = [
  {
    up: migration_20261123_220513_add_releases_collection.up,
    down: migration_20261123_220513_add_releases_collection.down,
    name: '20261123_220513_add_releases_collection',
  },
]
