from app.util.first_n_chars import first_n_chars
from app.util.get_first_word import get_first_word

def get_searchable_name_prefix (search_name, max_chars = 0):
    first_name = get_first_word(search_name)
    
    if max_chars > 0:
        trimmed_name = first_n_chars(first_name, max_chars)
        return trimmed_name
    
    return first_name