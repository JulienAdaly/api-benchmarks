// SQL query constants - loaded at compile time for better performance

// Auth
pub const SQL_LOGIN: &str = include_str!("../../../database/queries/auth/login.sql");
pub const SQL_ME: &str = include_str!("../../../database/queries/auth/me.sql");

// Users
pub const SQL_CREATE_USER: &str = include_str!("../../../database/queries/users/create.sql");
pub const SQL_GET_USER: &str = include_str!("../../../database/queries/users/get.sql");
pub const SQL_LIST_USERS: &str = include_str!("../../../database/queries/users/list.sql");
pub const SQL_UPDATE_USER: &str = include_str!("../../../database/queries/users/update.sql");
pub const SQL_DELETE_USER: &str = include_str!("../../../database/queries/users/delete.sql");

// Posts
pub const SQL_CREATE_POST: &str = include_str!("../../../database/queries/posts/create.sql");
pub const SQL_LIST_POSTS: &str = include_str!("../../../database/queries/posts/list.sql");
pub const SQL_GET_POST: &str = include_str!("../../../database/queries/posts/get.sql");
pub const SQL_GET_POST_AUTHOR: &str = include_str!("../../../database/queries/posts/get_author.sql");
pub const SQL_DELETE_POST: &str = include_str!("../../../database/queries/posts/delete.sql");

// Comments
pub const SQL_CREATE_COMMENT: &str = include_str!("../../../database/queries/comments/create.sql");
pub const SQL_LIST_COMMENTS: &str = include_str!("../../../database/queries/comments/list.sql");

// Likes
pub const SQL_CREATE_LIKE: &str = include_str!("../../../database/queries/likes/create.sql");
pub const SQL_DELETE_LIKE: &str = include_str!("../../../database/queries/likes/delete.sql");
