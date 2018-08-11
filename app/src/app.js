(async function(undefined) {
    "use strict";

    let ooml = new OOML.Namespace();
    window.app = ooml.objects.app;

    let schemas = await (await fetch(location.origin + '/schemas')).json();
    schemas.forEach(name => {
        app.header.schemaPicker.options.push({
            name: name,
            value: name,
        });
    });

    let currentSchema = location.hash.slice(1);
    if (currentSchema) {
        app.changeSchema(currentSchema);
    }

    window.onbeforeunload = e => {
        if (app.getUnsavedChanges()) {
            let msg = 'You may have unsaved changes';
            e.returnValue = msg;
            return msg;
        }
    };
})();
