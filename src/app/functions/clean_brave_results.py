import os
import json

def clean_results(results_obj):
    cleaned_result = {}

    cleaned_result["infobox"] = results_obj["pages"][0].get("infobox", "")
    cleaned_result["web"] = []

    for page in results_obj["pages"]:
        if "web" in page:
            if "results" in page["web"]:
                raw_web_results = page["web"]["results"]
                for result in raw_web_results:
                    new_result = {
                        "title": result.get("title", ""),
                        "url": result.get("url", ""),
                        "description": result.get("description", "")
                    }

                    if "deep_results" in result:
                        new_result["deep_results"] = result.get("deep_results", "")

                    cleaned_result["web"].append(new_result)

    return cleaned_result