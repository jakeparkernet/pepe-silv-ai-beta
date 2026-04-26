from pydantic import BaseModel

class Cursor(BaseModel):
    label: str = ""
    phase: str = ""