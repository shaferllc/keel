import type { Migration } from "@shaferllc/keel/core";

const migration: Migration = {
  name: "0001_create_posts",

  async up(schema) {
    await schema.createTable("posts", (t) => {
      t.id();
      t.string("title");
      t.text("body");
      t.timestamps();
    });
  },

  async down(schema) {
    await schema.dropTable("posts");
  },
};

export default migration;
