from pydantic import BaseModel

from typing import Optional


class LoginCredentialsModel(BaseModel):
    email: str
    password: str


class CreateUserModel(BaseModel):
    username: str
    email: str
    password: str


class UpdateUserModel(BaseModel):
    bio: Optional[str] = None


class PostCreateModel(BaseModel):
    content: str


class CommentCreateModel(BaseModel):
    content: str
