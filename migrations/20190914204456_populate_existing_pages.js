exports.up = function(knex, Promise) {
  return knex.raw('INSERT INTO pages("spaceName", number, "programId") SELECT "spaceName", number, id FROM programs')
};

exports.down = function(knex, Promise) {};
