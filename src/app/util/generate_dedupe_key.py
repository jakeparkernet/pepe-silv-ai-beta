import hashlib, json
from uuid import uuid4

def generate_dedupe_key (data):
    # TODO: FIX THIS LATER TO BE A TRY DEDUPE KEY AND ALLOW FOR DUPLICATE JOBS TO BE SUBSCRIBED TO EXISTING ONES vvv
    return str(hashlib.sha256(json.dumps(data, sort_keys=True, separators=(',', ':')).encode()).hexdigest()) + str(uuid4())
