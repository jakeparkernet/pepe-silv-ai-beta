from urllib.parse import urlparse

def domain_from_url(url):
    # Ensure the URL has a scheme so urlparse works correctly
    if not url.startswith(('http://', 'https://')):
        url = 'http://' + url

    parsed_url = urlparse(url)
    domain = parsed_url.netloc

    domain_parts = domain.split('.')

    if domain_parts[0] == 'www':
        return '.'.join(domain_parts[1:])
    
    return domain