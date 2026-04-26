from echo import echo

def lambda_handler(event, context):
    print("Received event:", event)

    message = event["message"]
    result = echo(event)
    
    return {
        "status_code": 200,
        "result": result
    }