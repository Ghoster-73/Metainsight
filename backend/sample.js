import axios from "axios";\nfunction run(task) {\n  return axios.get(task.url);\n}\nexport default run;
