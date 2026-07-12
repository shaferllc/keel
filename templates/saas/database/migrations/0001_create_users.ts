import type { Migration } from "@shaferllc/keel/core";

const migration: Migration = {
  name: "0001_create_users",

  async up(schema) {
    await schema.createTable("users", (t) => {
      t.id();
      t.string("name");
      t.string("email").unique();
      t.string("password");
      t.timestamps();
    });
  },

  async down(schema) {
    await schema.dropTable("users");
  },
};

export default migration;
